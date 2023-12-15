import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DefinitionBody } from 'aws-cdk-lib/aws-stepfunctions';
import { GraphqlApi, FieldLogLevel, Code, AuthorizationType, Definition } from 'aws-cdk-lib/aws-appsync';
import { Role, ServicePrincipal, PolicyStatement, AccountPrincipal, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { join } from 'path';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { AppSyncToStepFunction } from './app-sync-to-step-function-construct';
import { TenantStateMachine } from './tenant-state-machine';
import { AppSyncAuthorizer } from '../src/authorizer/cdk-construct';

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

        const { authorizerFunction } = new AppSyncAuthorizer(this, 'AppSyncAuthorizer', {
            tenant1Role,
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

        const endpoint = 'https://sync-states.' + this.region + '.amazonaws.com/';
        const httpDataSource = api.addHttpDataSource('StepFunctionsStateMachine', endpoint, {
            authorizationConfig: {
                signingRegion: this.region,
                signingServiceName: 'states',
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

        const { stateMachine: getItemStateMachine } = new TenantStateMachine(this, 'GetItemTenantStateMachine', {
            definitionBody: DefinitionBody.fromFile(join(__dirname, '../states/get-item.asl.json')),
            httpDataSource,
        });
        const { stateMachine: putItemStateMachine } = new TenantStateMachine(this, 'PutItemTenantStateMachine', {
            definitionBody: DefinitionBody.fromFile(join(__dirname, '../states/put-item.asl.json')),
            httpDataSource,
        });
        const { stateMachine: queryStateMachine } = new TenantStateMachine(this, 'QueryTenantStateMachine', {
            definitionBody: DefinitionBody.fromFile(join(__dirname, '../states/query.asl.json')),
            httpDataSource,
        });

        new AppSyncToStepFunction(this, 'AddSetAppSyncToStepFunction', {
            functionCode: Code.fromAsset(join(__dirname, '../graphql/Mutation.addSet.js')),
            graphqlApi: api,
            httpDataSource,
            resolverFieldName: 'addSet',
            resolverTypeName: 'Mutation',
            stateMachine: putItemStateMachine,
        });
        new AppSyncToStepFunction(this, 'GetSetAppSyncToStepFunction', {
            functionCode: Code.fromAsset(join(__dirname, '../graphql/Query.getSet.js')),
            graphqlApi: api,
            httpDataSource,
            resolverFieldName: 'getSet',
            resolverTypeName: 'Query',
            stateMachine: getItemStateMachine,
        });
        new AppSyncToStepFunction(this, 'ListSetsAppSyncToStepFunction', {
            functionCode: Code.fromAsset(join(__dirname, '../graphql/Query.listSets.js')),
            graphqlApi: api,
            httpDataSource,
            resolverFieldName: 'listSets',
            resolverTypeName: 'Query',
            stateMachine: queryStateMachine,
        });
    }
}
