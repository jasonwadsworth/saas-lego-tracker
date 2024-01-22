import { useEffect, useState } from 'react';

export function useTenantSettings() {
    const [localState, setLocalState] = useState<{ tenantSettings: TenantSettings | null; loading: boolean; error?: Error }>({
        tenantSettings: null,
        loading: true,
    });

    useEffect(() => {
        let cancelled = false;
        const loadTenantSettings = async () => {
            try {
                const result = await fetch(process.env.REACT_APP_LOCAL_DEV_URL ? process.env.REACT_APP_LOCAL_DEV_URL : `https://${window.location.host}/api/`);

                if (result.ok) {
                    const tenantSettings = await result.json();
                    if (!cancelled) {
                        setLocalState({ tenantSettings, loading: false });
                    }
                } else {
                    if (!cancelled) {
                        console.log('result', { result });
                        if (result.status >= 500) {
                            setLocalState({
                                tenantSettings: null,
                                loading: false,
                                error: new Error(`Error requesting Tenant settings: status code ${result.status}`),
                            });
                        } else if (result.status === 404) {
                            setLocalState({
                                tenantSettings: null,
                                loading: false,
                                error: new Error(`Error requesting Tenant settings: status code ${result.status}`),
                            });
                        } else {
                            setLocalState({ tenantSettings: null, loading: false });
                        }
                    }
                }
            } catch (e) {
                console.log('error', { e });
            }
        };

        loadTenantSettings();
        return () => {
            cancelled = true;
        };
    }, []);

    return localState;
}

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
