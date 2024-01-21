#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SaasLegoTrackerStack } from '../lib/saas-lego-tracker-stack';
import { TenantManagementStack } from '../lib/tenant-management-stack';
import { TenantShardStack } from '../lib/tenant-shard-stack';

const app = new cdk.App();

const managementAccount = '975050089975';
const managementRegion = 'us-west-2';
const organizationId = 'o-ofcakyadba';

// this is the management stack and should be deployed to only one AWS account
new TenantManagementStack(app, 'TenantManagement', {
    env: { account: managementAccount, region: managementRegion },
});

const tenantShardAccounts = [
    { name: '1', account: '730335196173', region: 'us-west-2' },
    { name: '2', account: '339713056438', region: 'us-east-2' },
    { name: '3', account: '211125531624', region: 'eu-west-1' },
];

for (const { account, name, region } of tenantShardAccounts) {
    // application stack
    new SaasLegoTrackerStack(app, `SaasLegoTrackerStack${name}`, {
        env: { account, region },
    });

    // tenant shard (includes provisioning)
    new TenantShardStack(app, `TenantShard${name}`, {
        managementAccount,
        managementRegion,
        env: { account, region },
    });
}
