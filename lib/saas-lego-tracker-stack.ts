import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DefinitionBody, LogLevel, Pass, StateMachine, StateMachineType } from 'aws-cdk-lib/aws-stepfunctions';
import {
    GraphqlApi,
    SchemaFile,
    FieldLogLevel,
    AppsyncFunction,
    Code,
    FunctionRuntime,
    Resolver,
    AuthorizationType,
    Definition,
} from 'aws-cdk-lib/aws-appsync';
import { Role, ServicePrincipal, PolicyStatement, AccountPrincipal, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { join } from 'path';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';

export class SaasLegoTrackerStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        new Table(this, 'Table', {
            partitionKey: { name: 'pk', type: AttributeType.STRING },
            sortKey: { name: 'sk', type: AttributeType.STRING },
            tableName: 'SaaSLEGOTracker',
        });

        const tenant1Id = '01HHNG3FHTRCHCRY26N72V5GQT';
        const tenant1Role = new Role(this, 'Tenant1Role', {
            assumedBy: new AccountPrincipal(this.account),
            path: '/tenant/',
            roleName: `Tenant${tenant1Id}`,
            inlinePolicies: {
                CompanyData: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: [
                                'dynamodb:BatchGetItem',
                                'dynamodb:BatchWriteItem',
                                'dynamodb:ConditionCheckItem',
                                'dynamodb:DeleteItem',
                                'dynamodb:GetItem',
                                'dynamodb:PutItem',
                                'dynamodb:Query',
                                'dynamodb:UpdateItem',
                            ],
                            resources: ['*'],
                            conditions: {
                                'ForAllValues:StringLike': {
                                    'dynamodb:LeadingKeys': [`${tenant1Id}*`],
                                },
                            },
                        }),
                    ],
                }),
            },
        });

        const getItemStateMachine = new StateMachine(this, 'GetItemStateMachine', {
            definitionBody: DefinitionBody.fromFile(join(__dirname, '../states/get-item.asl.json')),
            stateMachineType: StateMachineType.EXPRESS,
            logs: {
                destination: new LogGroup(this, 'GetItemStateMachineLogGroup'),
                includeExecutionData: true,
                level: LogLevel.ALL,
            },
        });
        getItemStateMachine.addToRolePolicy(
            new PolicyStatement({
                resources: [`arn:aws:iam::${this.account}:role/tenant/*`], // allow all "tenant" roles by using the path to distinguish them
                actions: ['sts:AssumeRole'],
            }),
        );
        const putItemStateMachine = new StateMachine(this, 'PutItemStateMachine', {
            definitionBody: DefinitionBody.fromFile(join(__dirname, '../states/put-item.asl.json')),
            stateMachineType: StateMachineType.EXPRESS,
            logs: {
                destination: new LogGroup(this, 'PutItemStateMachineLogGroup'),
                includeExecutionData: true,
                level: LogLevel.ALL,
            },
        });
        putItemStateMachine.addToRolePolicy(
            new PolicyStatement({
                resources: [`arn:aws:iam::${this.account}:role/tenant/*`], // allow all "tenant" roles by using the path to distinguish them
                actions: ['sts:AssumeRole'],
            }),
        );

        const authorizerFunction = new NodejsFunction(this, 'Authorizer', {
            architecture: Architecture.ARM_64,
            awsSdkConnectionReuse: true,
            bundling: { minify: true, sourceMap: true },
            description: 'AppSync Customer Authorizer',
            entry: join(__dirname, '/authorizer/handler.ts'),
            environment: {
                LOG_LEVEL: this.node.tryGetContext(`logLevel`) || 'INFO',
                NODE_OPTIONS: '--enable-source-maps',
                TENANT_1_ROLE_ARN: tenant1Role.roleArn,
            },
            logRetention: RetentionDays.TWO_WEEKS,
            memorySize: 1024,
            reservedConcurrentExecutions: 10,
            runtime: Runtime.NODEJS_18_X,
            timeout: Duration.seconds(3),
            tracing: Tracing.ACTIVE,
        });

        authorizerFunction.addPermission('appsync-data-authorizer', {
            principal: new ServicePrincipal('appsync.amazonaws.com'),
            action: 'lambda:InvokeFunction',
        });

        const api = new GraphqlApi(this, 'Api', {
            name: 'SaaSLEGO',
            definition: Definition.fromFile(join(__dirname, '../graphql/schema.graphql')),
            xrayEnabled: true,
            logConfig: {
                excludeVerboseContent: false,
                fieldLogLevel: FieldLogLevel.ALL,
            },
            authorizationConfig: {
                defaultAuthorization: {
                    authorizationType: AuthorizationType.LAMBDA,
                    lambdaAuthorizerConfig: {
                        handler: authorizerFunction,
                    },
                },
            },
        });

        const appSyncStepFunctionsRole = new Role(this, 'AppSyncStateMachineRole', {
            assumedBy: new ServicePrincipal('appsync.amazonaws.com'),
        });
        appSyncStepFunctionsRole.addToPolicy(
            new PolicyStatement({
                resources: ['*'],
                actions: ['states:StartSyncExecution'],
            }),
        );

        const endpoint = 'https://sync-states.' + this.region + '.amazonaws.com/';
        const httpDataSource = api.addHttpDataSource('StepFunctionsStateMachine', endpoint, {
            authorizationConfig: {
                signingRegion: this.region,
                signingServiceName: 'states',
            },
        });

        getItemStateMachine.grant(httpDataSource.grantPrincipal, 'states:StartSyncExecution');
        putItemStateMachine.grant(httpDataSource.grantPrincipal, 'states:StartSyncExecution');

        const getSetFunction = new AppsyncFunction(this, 'GetSetFunction', {
            name: 'GetSet',
            api,
            dataSource: httpDataSource,
            code: Code.fromAsset(join(__dirname, '../graphql/Query.getSet.js')),
            runtime: FunctionRuntime.JS_1_0_0,
        });

        const getItemPipelineVars = JSON.stringify({
            STATE_MACHINE_ARN: getItemStateMachine.stateMachineArn,
        });

        new Resolver(this, 'GetSetQueryResolver', {
            api,
            typeName: 'Query',
            fieldName: 'getSet',
            code: Code.fromInline(`
            // The before step
            export function request(...args) {
              console.log(args);
              return ${getItemPipelineVars}
            }

            // The after step
            export function response(ctx) {
              return ctx.prev.result
            }
          `),
            runtime: FunctionRuntime.JS_1_0_0,
            pipelineConfig: [getSetFunction],
        });

        const addSetFunction = new AppsyncFunction(this, 'AddSetFunction', {
            name: 'AddSet',
            api,
            dataSource: httpDataSource,
            code: Code.fromAsset(join(__dirname, '../graphql/Mutation.addSet.js')),
            runtime: FunctionRuntime.JS_1_0_0,
        });

        const putItemPipelineVars = JSON.stringify({
            STATE_MACHINE_ARN: putItemStateMachine.stateMachineArn,
        });

        new Resolver(this, 'AddSetMutationResolver', {
            api,
            typeName: 'Mutation',
            fieldName: 'addSet',
            code: Code.fromInline(`
            // The before step
            export function request(...args) {
              console.log(args);
              return ${putItemPipelineVars}
            }

            // The after step
            export function response(ctx) {
              return ctx.prev.result
            }
          `),
            runtime: FunctionRuntime.JS_1_0_0,
            pipelineConfig: [addSetFunction],
        });
    }
}
