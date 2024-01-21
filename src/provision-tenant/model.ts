export type ProvisionTenant = {
    awsAccount: string;
    domainName: string;
    region: string;
    tenantId: string;
    user: User;
};

export type JwtValidation = {
    tenantId: string;
    issuer: string;
    audience: string;
};

export type TenantSettings = {
    tenantId: string;
    awsAccount: string;
    region: string;
    userPoolArn: string;
    userPoolId: string;
    userPoolClientId: string;
    domainName: string;
    graphqlEndpoint: string;
};

export type User = {
    email: string;
    firstName: string;
    lastName: string;
};
