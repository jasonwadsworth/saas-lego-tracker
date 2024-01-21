import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { TenantInfo } from '../src/tenant-info/cdk-construct';
import { ProvisionTenant } from '../src/provision-tenant/cdk-construct';

interface Props extends StackProps {}
export class TenantManagementStack extends Stack {
    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id, props);

        const table = new Table(this, 'Table', {
            tableName: 'TenantManagement',
            partitionKey: { name: 'pk', type: AttributeType.STRING },
            sortKey: { name: 'sk', type: AttributeType.STRING },
        });

        const httpApi = new HttpApi(this, 'HttpApi');

        new TenantInfo(this, 'TenantInfo', { httpApi, table });

        new ProvisionTenant(this, 'CreateTenant', { table });
    }
}
