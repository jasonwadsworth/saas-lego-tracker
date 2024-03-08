import { BootstraplessSynthesizer, CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CorsHttpMethod, HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { TenantInfo } from '../src/tenant-info/cdk-construct';
import { ProvisionTenant } from '../src/provision-tenant/cdk-construct';
import {
    CloudFrontAllowedCachedMethods,
    CloudFrontAllowedMethods,
    CloudFrontWebDistribution,
    LambdaEdgeEventType,
    OriginAccessIdentity,
    SSLMethod,
    SecurityPolicyProtocol,
    experimental,
} from 'aws-cdk-lib/aws-cloudfront';
import { Code, Runtime } from 'aws-cdk-lib/aws-lambda';
import path = require('path');
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { HostedZone, RecordSet, RecordTarget, RecordType } from 'aws-cdk-lib/aws-route53';
import { Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { TenantStack } from './tenant-stack';

interface Props extends StackProps {
    appCertificateArn: string;
    domainName: string;
    hostedZoneId: string;
}

export class TenantManagementStack extends Stack {
    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id, props);

        const { appCertificateArn, domainName, hostedZoneId } = props;

        const stack = Stack.of(this);

        new CfnOutput(this, 'HostedZoneId', {
            value: hostedZoneId,
            exportName: 'HostedZoneId',
        });

        // this function will rewrite most requests to index.html. it uses a regex to exclude things like images and other static files
        const rewriteToIndexFunction = new experimental.EdgeFunction(this, 'RewriteToIndex', {
            code: Code.fromAsset(path.join(__dirname, '../src/rewrite-to-index')),
            runtime: Runtime.NODEJS_20_X,
            handler: 'rewrite-to-index.handler',
            initialPolicy: [
                new PolicyStatement({
                    actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                    resources: [
                        // make sure not to include region here, because it will be in any/all depending on what is closest to the user
                        `arn:aws:logs:*:${this.account}:log-group:/aws/lambda/*.*RewriteToIndex*:*`,
                    ],
                }),
            ],
        });

        const hostedZone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', { hostedZoneId, zoneName: domainName });

        const httpApi = new HttpApi(this, 'HttpApi', {
            corsPreflight: {
                allowOrigins: ['*'],
                allowMethods: [CorsHttpMethod.ANY],
            },
        });

        // this bucket will hold all the content for our app
        const appBucket = new Bucket(this, 'AppBucket', {
            blockPublicAccess: {
                blockPublicAcls: true,
                blockPublicPolicy: true,
                ignorePublicAcls: true,
                restrictPublicBuckets: true,
            },
            objectOwnership: ObjectOwnership.OBJECT_WRITER,
            encryption: BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            publicReadAccess: false,
        });

        // this identity will be used to allow CloudFront to access the bucket
        const originAccessIdentity = new OriginAccessIdentity(this, 'OriginAccessIdentity', {
            comment: `access-identity-${appBucket.bucketDomainName}`,
        });

        // this is the CloudFront distribution for the app
        const distribution = new CloudFrontWebDistribution(this, 'AppDistribution', {
            comment: 'SaaS LEGO Tracker App',
            originConfigs: [
                // this is the default origin
                {
                    s3OriginSource: {
                        s3BucketSource: appBucket,
                        originAccessIdentity,
                    },
                    behaviors: [
                        {
                            isDefaultBehavior: true,
                            lambdaFunctionAssociations: [
                                // this hooks up the rewrite to index function
                                {
                                    eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                                    lambdaFunction: rewriteToIndexFunction.currentVersion,
                                },
                            ],
                        },
                    ],
                },
                // this is the origin for the /api/* routes to send traffic to the HTTP API
                {
                    customOriginSource: {
                        domainName: `${httpApi.apiId}.execute-api.${stack.region}.amazonaws.com`,
                    },
                    behaviors: [
                        {
                            pathPattern: '/api/*',
                            cachedMethods: CloudFrontAllowedCachedMethods.GET_HEAD_OPTIONS,
                            allowedMethods: CloudFrontAllowedMethods.GET_HEAD_OPTIONS,
                            forwardedValues: {
                                cookies: {
                                    forward: 'all',
                                },
                                headers: ['Authorization', 'Access-Control-Request-Headers', 'Access-Control-Request-Methods'],
                                queryString: true,
                            },
                        },
                    ],
                },
            ],
            viewerCertificate: {
                // the alias here is the root domain and a wildcard domain
                aliases: [domainName, `*.${domainName}`],
                props: {
                    acmCertificateArn: appCertificateArn,
                    sslSupportMethod: SSLMethod.SNI,
                    minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
                },
            },
        });

        // this creates an alias record in Route53 that points the domain at the CloudFront distribution
        new RecordSet(this, 'RecordSet', {
            recordType: RecordType.A,
            target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
            zone: hostedZone,
            recordName: domainName,
        });

        // this creates an alias record in Route53 that points *.domain at the CloudFront distribution
        new RecordSet(this, 'WildcardRecordSet', {
            recordType: RecordType.A,
            target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
            zone: hostedZone,
            recordName: `*.${domainName}`,
        });

        new BucketDeployment(this, 'AuditorAppBucketDeployment', {
            sources: [Source.asset(path.join(__dirname, '../web/saas-lego-tracker/build'))],
            destinationBucket: appBucket,
            distribution: distribution,
            distributionPaths: ['/*'],
        });

        const table = new Table(this, 'Table', {
            tableName: 'TenantManagement',
            partitionKey: { name: 'pk', type: AttributeType.STRING },
            sortKey: { name: 'sk', type: AttributeType.STRING },
        });

        new TenantInfo(this, 'TenantInfo', { httpApi, table });

        new ProvisionTenant(this, 'CreateTenant', { table });

        const tenantStack = new TenantStack(this, 'TenantStack', {
            synthesizer: new BootstraplessSynthesizer(),
        });
    }
}
