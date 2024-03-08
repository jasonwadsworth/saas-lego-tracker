import { CfnParameter, Duration, Fn, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { AccountPrincipal, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { DefinitionBody } from 'aws-cdk-lib/aws-stepfunctions';
import { GraphqlApi, FieldLogLevel, Code, AuthorizationType, Definition } from 'aws-cdk-lib/aws-appsync';
import { join } from 'path';
import { AppSyncToStepFunction } from './app-sync-to-step-function-construct';
import { TenantStateMachine } from './tenant-state-machine';
import { AppSyncAuthorizer } from '../src/authorizer/cdk-construct';
import { CognitoPreTokenGeneration } from '../src/cognito/pre-token-generation/cdk-construct';
import { AccountRecovery, AdvancedSecurityMode, OAuthScope, StringAttribute, UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { Function } from 'aws-cdk-lib/aws-lambda';

export class TenantStack extends Stack {
    constructor(scope: Construct, id: string, props: StackProps) {
        super(scope, id, props);

        const stack = Stack.of(this);

        const parameterTenantId = new CfnParameter(this, 'TenantId', {
            type: 'String',
            description: 'The ID of the tenant',
        });
        const parameterDomainName = new CfnParameter(this, 'DomainName', {
            type: 'String',
            description: 'The domain name of the tenant',
        });

        const tenantId = parameterTenantId.valueAsString;
        const domainName = parameterDomainName.valueAsString;

        const userPool = new UserPool(this, 'UserPool', {
            userPoolName: `TenantUserPool-${tenantId}`,
            autoVerify: { email: true },
            signInAliases: { email: true, preferredUsername: true },
            lambdaTriggers: {
                preTokenGeneration: Function.fromFunctionArn(this, 'PreTokenGeneration', Fn.importValue('PreTokenGenerationFunctionArn')),
            },
            accountRecovery: AccountRecovery.EMAIL_ONLY,
            customAttributes: {
                tenant_id: new StringAttribute({ mutable: false }),
            },
            signInCaseSensitive: false,
            selfSignUpEnabled: false,
        });

        const userPoolClient = new UserPoolClient(this, 'UserPoolClient', {
            userPool,
            userPoolClientName: 'default',
            authFlows: { userSrp: true },
            oAuth: {
                flows: { authorizationCodeGrant: true },
                callbackUrls: [`https://${domainName}/login`],
                logoutUrls: [`https://${domainName}/logout`],
                scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
            },
            generateSecret: false,
            preventUserExistenceErrors: true,
            refreshTokenValidity: Duration.days(30),
        });

        const tenantRole = new Role(this, 'TenantRole', {
            assumedBy: new AccountPrincipal(stack.account),
            description: "This role is the role used when accessing a company's data (both for data and management APIs).",
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
                                    'dynamodb:LeadingKeys': [`${tenantId}*`],
                                },
                            },
                        }),
                        new PolicyStatement({
                            actions: ['s3:ListBucket'],
                            resources: [`arn:aws:s3:::*`],
                            conditions: {
                                StringEquals: {
                                    's3:prefix': [''],
                                    's3:delimiter': ['/'],
                                },
                            },
                        }),
                        new PolicyStatement({
                            actions: ['s3:ListBucket', 's3:ListBucketVersions'],
                            resources: [`arn:aws:s3:::*`],
                            conditions: {
                                StringLike: {
                                    's3:prefix': [`${tenantId}/*`],
                                },
                            },
                        }),
                        new PolicyStatement({
                            actions: ['s3:PutObject*', 's3:GetObject*', 's3:DeleteObject*'],
                            resources: [`arn:aws:s3:::*/${tenantId}/*`],
                        }),
                        new PolicyStatement({
                            actions: ['cognito-idp:*'],
                            resources: [userPool.userPoolArn],
                        }),
                    ],
                }),
            },
        });
    }
}
