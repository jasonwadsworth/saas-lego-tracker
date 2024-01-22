#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TenantManagementStack } from '../lib/tenant-management-stack';
import { TenantShardStack } from '../lib/tenant-shard-stack';
import { TenantManagementUsEast1Stack } from '../lib/tenant-management-us-east-1-stack';

const app = new cdk.App();

const managementAccount = '975050089975';
const managementRegion = 'us-west-2';
const domainName = 'saas-lego.wadsworth.dev';

const { appCertificateArn, hostedZoneId } = new TenantManagementUsEast1Stack(app, 'TenantManagementUsEast1', {
    domainName,
    env: { account: managementAccount, region: 'us-east-1' },
});

// this is the management stack and should be deployed to only one AWS account
new TenantManagementStack(app, 'TenantManagement', {
    appCertificateArn,
    crossRegionReferences: true,
    domainName,
    env: { account: managementAccount, region: managementRegion },
    hostedZoneId,
});

const tenantShardAccounts = [
    { name: '1', account: '730335196173', region: 'us-west-2' },
    { name: '2', account: '339713056438', region: 'us-east-2' },
    { name: '3', account: '211125531624', region: 'eu-west-1' },
];

for (const { account, name, region } of tenantShardAccounts) {
    // tenant shard
    new TenantShardStack(app, `TenantShard${name}`, {
        managementAccount,
        managementRegion,
        env: { account, region },
    });
}
