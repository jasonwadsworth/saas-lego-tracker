import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { AccountPrincipal, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { DefinitionBody } from 'aws-cdk-lib/aws-stepfunctions';
import { GraphqlApi, FieldLogLevel, Code, AuthorizationType, Definition } from 'aws-cdk-lib/aws-appsync';
import { join } from 'path';
import { AppSyncToStepFunction } from './app-sync-to-step-function-construct';
import { TenantStateMachine } from './tenant-state-machine';
import { AppSyncAuthorizer } from '../src/authorizer/cdk-construct';
import { CfnParameter } from 'aws-cdk-lib/aws-ssm';
import { CognitoPreTokenGeneration } from '../src/cognito/pre-token-generation/cdk-construct';

interface Props extends StackProps {
    managementAccount: string;
    managementRegion: string;
}

export class TenantShardStack extends Stack {
    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id, props);

        const { managementAccount, managementRegion } = props;

        const stack = Stack.of(this);

        const tenantManagementTable = new Table(this, 'TenantManagementTable', {
            tableName: 'TenantManagement',
            partitionKey: { name: 'pk', type: AttributeType.STRING },
            sortKey: { name: 'sk', type: AttributeType.STRING },
        });

        new Role(this, 'Provisioning', {
            assumedBy: new AccountPrincipal(managementAccount),
            description: 'Used for tenant provisioning',
            roleName: 'TenantProvisioning',
            path: '/tenant-management/',
            inlinePolicies: {
                dynamodb: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['dynamodb:*Item'],
                            resources: [tenantManagementTable.tableArn],
                        }),
                    ],
                }),
                ssm: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['ssm:GetParameter'],
                            resources: [`arn:${stack.partition}:ssm:${stack.region}:${stack.account}:parameter/AccountInfo`],
                        }),
                    ],
                }),
                cognito: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: [
                                'cognito-idp:CreateUserPool',
                                'cognito-idp:SetUserPoolMfaConfig',
                                'cognito-idp:CreateUserPoolClient',
                                'cognito-idp:AdminCreateUser',
                            ],
                            resources: [`arn:${stack.partition}:cognito-idp:${stack.region}:${stack.account}:userpool/*`],
                        }),
                    ],
                }),
                iam: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ['iam:CreateRole', 'iam:PutRolePolicy'],
                            resources: [`arn:${stack.partition}:iam::${stack.account}:role/tenant/*`],
                        }),
                    ],
                }),
            },
        });

        new Table(this, 'AppTable', {
            partitionKey: { name: 'pk', type: AttributeType.STRING },
            sortKey: { name: 'sk', type: AttributeType.STRING },
            tableName: 'SaaSLEGOTracker',
        });

        const { authorizerFunction } = new AppSyncAuthorizer(this, 'AppSyncAuthorizer', {
            tenantManagementTable,
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

        const { lambdaFunction } = new CognitoPreTokenGeneration(this, 'CognitoPreTokenGeneration');

        new CfnParameter(this, 'AccountInfo', {
            type: 'String',
            value: JSON.stringify({ graphqlEndpoint: api.graphqlUrl, preTokenGenerationArn: lambdaFunction.functionArn }),
            name: 'AccountInfo',
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
