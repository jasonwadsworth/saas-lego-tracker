import { PreTokenGenerationAuthenticationTriggerEvent } from 'aws-lambda';

export const handler = async (event: PreTokenGenerationAuthenticationTriggerEvent): Promise<PreTokenGenerationAuthenticationTriggerEvent> => {
    console.debug('Event', { event });

    if (!event) {
        throw new Error('Missing event.');
    }

    const { request, userName, userPoolId } = event;
    const { userAttributes } = request || {};

    // none federated users will have these values set in Cognito
    let { 'dev:custom:tenant_id': tenantId } = userAttributes || {};
    if (!tenantId) {
        throw new Error('Missing tenantId');
    }

    const claimsOverrideDetails = {
        claimsToAddOrOverride: {
            tenantId,
        },
    };

    // eslint-disable-next-line no-param-reassign
    event.response = {
        claimsOverrideDetails,
    };

    return event;
};
