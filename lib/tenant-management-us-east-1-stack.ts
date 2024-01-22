import { CfnOutput, Fn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { CfnServiceLinkedRole } from 'aws-cdk-lib/aws-iam';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

interface Props extends StackProps {
    domainName: string;
}

export class TenantManagementUsEast1Stack extends Stack {
    public readonly hostedZoneNameServers: CfnOutput;

    public readonly appCertificateArn: string;

    public readonly hostedZoneId: string;

    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id, props);

        const stack = Stack.of(this);

        const { domainName } = props;

        const hostedZone = new HostedZone(this, 'HostedZone', {
            zoneName: domainName,
        });

        hostedZone.applyRemovalPolicy(RemovalPolicy.RETAIN);

        if (!hostedZone.hostedZoneNameServers) throw new Error('Expected name servers for hosted zone.');

        this.hostedZoneNameServers = new CfnOutput(this, 'HostedZoneNameServers', {
            value: Fn.join(',', hostedZone.hostedZoneNameServers),
            description: 'The NS records for the hosted zone',
        });

        // create a cert for the auditor app domain
        const appCertificate = new Certificate(this, 'AppCertificate', {
            domainName: `${domainName}`,
            validation: CertificateValidation.fromDns(hostedZone),
            subjectAlternativeNames: [
                // include armanino.
                `*.${domainName}`,
            ],
        });

        new CfnOutput(this, 'AppCertificateArn', {
            value: appCertificate.certificateArn,
            description: 'The ARN of the app certificate',
        });

        // this will be used elsewhere and it can only be created once, so creating it here before someone accidentally creates in via the Console
        new CfnServiceLinkedRole(this, 'AppSyncServiceLinkedRole', {
            awsServiceName: 'appsync.amazonaws.com',
        });

        this.appCertificateArn = appCertificate.certificateArn;
        this.hostedZoneId = hostedZone.hostedZoneId;

        new CfnOutput(this, 'HostedZoneId', {
            value: hostedZone.hostedZoneId,
            exportName: 'HostedZoneId',
        });
    }
}
