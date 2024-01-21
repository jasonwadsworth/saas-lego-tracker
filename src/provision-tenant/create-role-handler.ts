import { Context } from 'aws-lambda';
import { CreateRoleCommand, IAMClient, PutRolePolicyCommand } from '@aws-sdk/client-iam';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { TenantSettings } from './model';

const sts = new STSClient({});

export const handler = async (event: TenantSettings, context: Context): Promise<void> => {
    console.log(event);

    const { awsAccount, tenantId, userPoolArn } = event;

    await createIamRole({ awsAccount, tenantId, userPoolArn });
};

export async function createIamRole({ awsAccount, tenantId, userPoolArn }: { awsAccount: string; tenantId: string; userPoolArn: string }): Promise<void> {
    const stsResponse = await sts.send(
        new AssumeRoleCommand({
            RoleArn: `arn:aws:iam::${awsAccount}:role/tenant-management/TenantProvisioning`,
            RoleSessionName: 'TenantProvisioning',
        }),
    );

    if (!stsResponse.Credentials || !stsResponse.Credentials.AccessKeyId || !stsResponse.Credentials.SecretAccessKey) {
        throw new Error('Unable to get credentials');
    }

    const iamClient = new IAMClient({
        credentials: {
            accessKeyId: stsResponse.Credentials.AccessKeyId,
            secretAccessKey: stsResponse.Credentials.SecretAccessKey,
            sessionToken: stsResponse.Credentials.SessionToken,
        },
    });

    const createRole = new CreateRoleCommand({
        RoleName: tenantId,
        Description: `Role for tenant ${tenantId}`,
        AssumeRolePolicyDocument: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: {
                        AWS: `arn:aws:iam::${awsAccount}:root`,
                    },
                    Action: ['sts:AssumeRole', 'sts:SetSourceIdentity'],
                },
            ],
        }),
        Path: '/tenant/',
    });

    try {
        await iamClient.send(createRole);
    } catch (e) {
        const error = e as Error;
        if ('name' in error && error.name === 'EntityAlreadyExists') {
            console.warn('Error creating role. This may be because the role already exists.', e as Error);
        } else {
            throw e;
        }
    }

    const statements = getTenantRolePolicyStatements({ tenantId, userPoolArn });
    const putRolePolicy = new PutRolePolicyCommand({
        PolicyDocument: JSON.stringify({
            Version: '2012-10-17',
            Statement: statements,
        }),
        PolicyName: `Tenant-${tenantId}`,
        RoleName: tenantId,
    });

    await iamClient.send(putRolePolicy);
}

function getTenantRolePolicyStatements({ tenantId, userPoolArn }: { tenantId: string; userPoolArn: string }): any {
    return [
        // DynamoDB access to the tenant's data
        {
            Action: [
                'dynamodb:ConditionCheckItem',
                'dynamodb:GetItem',
                'dynamodb:BatchGetItem',
                'dynamodb:Query',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:BatchWriteItem',
            ],
            Effect: 'Allow',
            Resource: ['*'],
            Condition: {
                'ForAllValues:StringLike': {
                    'dynamodb:LeadingKeys': [`${tenantId}*`],
                },
            },
        },
        // S3 access to list root items
        {
            Action: ['s3:ListBucket'],
            Effect: 'Allow',
            Resource: [`arn:aws:s3:::*`],
            Condition: {
                StringEquals: {
                    's3:prefix': [''],
                    's3:delimiter': ['/'],
                },
            },
        },
        // S3 access to list items that are for the tenant
        {
            Action: ['s3:ListBucket', 's3:ListBucketVersions'],
            Effect: 'Allow',
            Resource: [`arn:aws:s3:::*`],
            Condition: {
                StringLike: {
                    's3:prefix': [`${tenantId}/*`],
                },
            },
        },
        // S3 access to work with tenant's data
        {
            Action: ['s3:PutObject*', 's3:GetObject*', 's3:DeleteObject*'],
            Effect: 'Allow',
            Resource: [`arn:aws:s3:::*/${tenantId}/*`],
        },
        // Cognito permissions for tenant's user pool
        {
            Action: ['cognito-idp:*'],
            Effect: 'Allow',
            Resource: [userPoolArn],
        },
    ];
}
