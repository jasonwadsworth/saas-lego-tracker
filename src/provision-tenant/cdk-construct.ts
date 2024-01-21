import { Duration, Stack } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Chain, StateMachine, TaskInput, TaskRole } from 'aws-cdk-lib/aws-stepfunctions';
import { CallAwsService, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import path = require('path');

interface Props {
    table: Table;
}

export class ProvisionTenant extends Construct {
    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id);

        const { table } = props;

        const createCognitoUserPoolLambda = new NodejsFunction(this, 'CreateUserPoolHandler', {
            architecture: Architecture.ARM_64,
            awsSdkConnectionReuse: true,
            bundling: { minify: true, sourceMap: true },
            entry: path.join(__dirname, 'create-user-pool-handler.ts'),
            environment: {
                LOG_LEVEL: this.node.tryGetContext(`logLevel`) || 'INFO',
                NODE_OPTIONS: '--enable-source-maps',
            },
            initialPolicy: [
                new PolicyStatement({
                    actions: ['sts:AssumeRole'],
                    resources: ['arn:aws:iam::*:role/tenant-management/TenantProvisioning'],
                }),
            ],
            logRetention: RetentionDays.TWO_WEEKS,
            memorySize: 1024,
            runtime: Runtime.NODEJS_20_X,
            timeout: Duration.seconds(30),
            tracing: Tracing.ACTIVE,
        });

        // Create IAM Role Lambda
        const createIAMRoleLambda = new NodejsFunction(this, 'CreateIAMRoleLambda', {
            architecture: Architecture.ARM_64,
            awsSdkConnectionReuse: true,
            bundling: { minify: true, sourceMap: true },
            entry: path.join(__dirname, 'create-role-handler.ts'),
            environment: {
                LOG_LEVEL: this.node.tryGetContext(`logLevel`) || 'INFO',
                NODE_OPTIONS: '--enable-source-maps',
            },
            initialPolicy: [
                new PolicyStatement({
                    actions: ['sts:AssumeRole'],
                    resources: ['arn:aws:iam::*:role/tenant-management/TenantProvisioning'],
                }),
            ],
            logRetention: RetentionDays.TWO_WEEKS,
            memorySize: 1024,
            runtime: Runtime.NODEJS_20_X,
            timeout: Duration.seconds(30),
            tracing: Tracing.ACTIVE,
        });

        // Create user Lambda
        const createUserLambda = new NodejsFunction(this, 'CreateUserLambda', {
            architecture: Architecture.ARM_64,
            awsSdkConnectionReuse: true,
            bundling: { minify: true, sourceMap: true },
            entry: path.join(__dirname, 'create-user-handler.ts'),
            environment: {
                LOG_LEVEL: this.node.tryGetContext(`logLevel`) || 'INFO',
                NODE_OPTIONS: '--enable-source-maps',
            },
            initialPolicy: [
                new PolicyStatement({
                    actions: ['sts:AssumeRole'],
                    resources: ['arn:aws:iam::*:role/tenant-management/TenantProvisioning'],
                }),
            ],
            logRetention: RetentionDays.TWO_WEEKS,
            memorySize: 1024,
            runtime: Runtime.NODEJS_20_X,
            timeout: Duration.seconds(30),
            tracing: Tracing.ACTIVE,
        });

        // Step Functions definition
        const definition = Chain.start(
            new LambdaInvoke(this, 'CreateCognitoUserPoolTask', {
                lambdaFunction: createCognitoUserPoolLambda,
                resultPath: '$.CreateCognitoUserPoolResult',
                payloadResponseOnly: true,
            }),
        )
            .next(
                new LambdaInvoke(this, 'CreateIAMRoleTask', {
                    lambdaFunction: createIAMRoleLambda,
                    resultPath: '$.CreateIAMRoleResult',
                    inputPath: '$.CreateCognitoUserPoolResult.tenantSettings',
                    payloadResponseOnly: true,
                }),
            )
            .next(
                new CallAwsService(this, 'SaveTenantSettings', {
                    action: 'putItem',
                    service: 'dynamodb',
                    parameters: {
                        TableName: 'TenantManagement',
                        Item: {
                            pk: {
                                S: 'TenantSettings',
                            },
                            sk: {
                                'S.$': '$.tenantId',
                            },
                            tenantId: {
                                'S.$': '$.tenantId',
                            },
                            awsAccount: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.awsAccount',
                            },
                            region: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.region',
                            },
                            userPoolArn: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.userPoolArn',
                            },
                            userPoolId: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.userPoolId',
                            },
                            userPoolClientId: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.userPoolClientId',
                            },
                            domainName: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.domainName',
                            },
                            graphqlEndpoint: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.graphqlEndpoint',
                            },
                        },
                    },
                    iamResources: ['*'],
                    additionalIamStatements: [
                        new PolicyStatement({
                            actions: ['dynamodb:PutItem'],
                            resources: [table.tableArn],
                        }),
                    ],
                    resultPath: '$.SaveTenantSettingsResults',
                }),
            )
            .next(
                new CallAwsService(this, 'SaveHostRecord', {
                    action: 'putItem',
                    service: 'dynamodb',
                    parameters: {
                        TableName: 'TenantManagement',
                        Item: {
                            pk: {
                                S: 'Host',
                            },
                            sk: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.domainName',
                            },
                            tenantId: {
                                'S.$': '$.tenantId',
                            },
                            awsAccount: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.awsAccount',
                            },
                            region: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.region',
                            },
                            userPoolArn: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.userPoolArn',
                            },
                            userPoolId: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.userPoolId',
                            },
                            userPoolClientId: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.userPoolClientId',
                            },
                            domainName: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.domainName',
                            },
                            graphqlEndpoint: {
                                'S.$': '$.CreateCognitoUserPoolResult.tenantSettings.graphqlEndpoint',
                            },
                        },
                    },
                    iamResources: ['*'],
                    additionalIamStatements: [
                        new PolicyStatement({
                            actions: ['dynamodb:PutItem'],
                            resources: [table.tableArn],
                        }),
                    ],
                    resultPath: '$.SaveHostRecordResults',
                }),
            )
            .next(
                new LambdaInvoke(this, 'CreateUserTask', {
                    lambdaFunction: createUserLambda,
                    resultPath: '$.CreateUserResult',
                    payload: TaskInput.fromObject({ 'tenantSettings.$': '$.CreateCognitoUserPoolResult.tenantSettings', 'user.$': '$.user' }),
                    payloadResponseOnly: true,
                }),
            );

        // Create Step Function state machine
        const stateMachine = new StateMachine(this, 'TenantProvisioningStateMachine', {
            definition,
            stateMachineName: 'TenantProvisioning',
        });

        stateMachine.addToRolePolicy(
            new PolicyStatement({
                actions: ['sts:AssumeRole'],
                resources: ['arn:aws:iam::*:role/tenant-management/TenantProvisioning'],
            }),
        );
    }
}
