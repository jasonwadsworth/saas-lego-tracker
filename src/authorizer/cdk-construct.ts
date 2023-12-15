import { Duration } from 'aws-cdk-lib';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, IFunction, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import path = require('path');

interface Props {
    tenant1Role: Role;
    tenant2Role: Role;
}

export class AppSyncAuthorizer extends Construct {
    public readonly authorizerFunction: IFunction;

    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id);

        const { tenant1Role, tenant2Role } = props;

        this.authorizerFunction = new NodejsFunction(this, 'Authorizer', {
            architecture: Architecture.ARM_64,
            awsSdkConnectionReuse: true,
            bundling: { minify: true, sourceMap: true },
            description: 'AppSync Customer Authorizer',
            entry: path.join(__dirname, '/handler.ts'),
            environment: {
                LOG_LEVEL: this.node.tryGetContext(`logLevel`) || 'INFO',
                NODE_OPTIONS: '--enable-source-maps',
                TENANT_1_ROLE_ARN: tenant1Role.roleArn,
                TENANT_2_ROLE_ARN: tenant2Role.roleArn,
            },
            logRetention: RetentionDays.TWO_WEEKS,
            memorySize: 1024,
            reservedConcurrentExecutions: 10,
            runtime: Runtime.NODEJS_18_X,
            timeout: Duration.seconds(3),
            tracing: Tracing.ACTIVE,
        });

        this.authorizerFunction.addPermission('appsync-data-authorizer', {
            principal: new ServicePrincipal('appsync.amazonaws.com'),
            action: 'lambda:InvokeFunction',
        });
    }
}
