import { Duration } from 'aws-cdk-lib';
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import path = require('path');

interface Props {
    httpApi: HttpApi;
    table: Table;
}

export class TenantInfo extends Construct {
    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id);

        const { httpApi, table } = props;

        const nodejsFunction = new NodejsFunction(this, 'TenantInfo', {
            architecture: Architecture.ARM_64,
            awsSdkConnectionReuse: true,
            bundling: { minify: true, sourceMap: true },
            entry: path.join(__dirname, '/handler.ts'),
            environment: {
                LOG_LEVEL: this.node.tryGetContext(`logLevel`) || 'INFO',
                NODE_OPTIONS: '--enable-source-maps',
                TABLE_NAME: table.tableName,
            },
            logRetention: RetentionDays.TWO_WEEKS,
            memorySize: 1024,
            runtime: Runtime.NODEJS_20_X,
            timeout: Duration.seconds(3),
            tracing: Tracing.ACTIVE,
        });

        table.grantReadData(nodejsFunction);

        httpApi.addRoutes({ path: '/', integration: new HttpLambdaIntegration('Root', nodejsFunction) });
    }
}
