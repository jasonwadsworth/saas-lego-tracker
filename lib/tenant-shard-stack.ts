import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { AccountPrincipal, PolicyDocument, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';

interface Props extends StackProps {
    managementAccount: string;
    managementRegion: string;
}

export class TenantShardStack extends Stack {
    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id, props);

        const { managementAccount, managementRegion } = props;

        const stack = Stack.of(this);

        const table = new Table(this, 'Table', {
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
                            resources: [table.tableArn],
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
    }
}
