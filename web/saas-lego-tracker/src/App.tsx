import React from 'react';
import '@aws-amplify/ui-react/styles.css';
import { signOut } from '@aws-amplify/auth';
import { Authenticator } from '@aws-amplify/ui-react';
import { ApolloProvider } from '@apollo/client';
import { Amplify } from 'aws-amplify';
import logo from './logo.svg';
import { useTenantSettings } from './hooks/useTenantSettings';
import { useConfigureApollo } from './hooks/useConfigureApollo';
import { AddSet } from './components/AddSet';

function App() {
    const { tenantSettings, loading } = useTenantSettings();

    if (tenantSettings) {
        Amplify.configure({
            Auth: {
                Cognito: {
                    userPoolId: tenantSettings.userPoolId,
                    userPoolClientId: tenantSettings.userPoolClientId,
                },
            },
        });
    }

    const client = useConfigureApollo(tenantSettings);

    if (loading) {
        return <div>Loading...</div>;
    }

    if (!tenantSettings) {
        return <div>No login information found</div>;
    }

    if (!client) {
        return <div>Unable to configure Apollo</div>;
    }

    return (
        <Authenticator hideSignUp>
            <ApolloProvider client={client}>
                <div className="App">
                    <header className="App-header">
                        <img src={logo} className="App-logo" alt="logo" />
                        <p>
                            Edit <code>src/App.tsx</code> and save to reload.
                        </p>
                        <a className="App-link" href="https://reactjs.org" target="_blank" rel="noopener noreferrer">
                            Learn React
                        </a>
                    </header>
                </div>
                <AddSet />
                <button onClick={() => signOut()}>Sign out</button>
            </ApolloProvider>
        </Authenticator>
    );
}

export default App;
