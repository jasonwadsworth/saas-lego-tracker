import { Duration, Stack } from 'aws-cdk-lib';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import path = require('path');

export class CognitoPreTokenGeneration extends Construct {
    public readonly lambdaFunction: NodejsFunction;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        const stack = Stack.of(this);

        const lambdaFunction = new NodejsFunction(this, 'Handler', {
            architecture: Architecture.ARM_64,
            awsSdkConnectionReuse: true,
            bundling: { minify: true, sourceMap: true },
            description: 'Cognito Handler for Pre Token Generation',
            entry: path.join(__dirname, 'handler.ts'),
            environment: {
                LOG_LEVEL: this.node.tryGetContext(`logLevel`) || 'INFO',
                NODE_OPTIONS: '--enable-source-maps',
            },
            logRetention: RetentionDays.TWO_WEEKS,
            memorySize: 1024,
            runtime: Runtime.NODEJS_20_X,
            timeout: Duration.seconds(3),
            tracing: Tracing.ACTIVE,
        });

        this.lambdaFunction = lambdaFunction;

        lambdaFunction.addPermission('Cognito', {
            principal: new ServicePrincipal('cognito-idp.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceAccount: stack.account,
        });
    }
}
