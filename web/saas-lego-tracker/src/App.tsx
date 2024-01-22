import React from 'react';
import logo from './logo.svg';
import { useTenantSettings } from './hooks/useTenantSettings';
import { Amplify } from 'aws-amplify';
import { signOut } from '@aws-amplify/auth';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';

function App() {
    const { tenantSettings, loading, error } = useTenantSettings();

    if (tenantSettings) {
        Amplify.configure({
            Auth: {
                Cognito: {
                    userPoolId: tenantSettings.userPoolId,
                    userPoolClientId: tenantSettings.userPoolClientId,
                },
            },
        });
    } else {
        return <div>No login information found</div>;
    }

    return (
        <Authenticator hideSignUp>
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
            <button onClick={() => signOut()}>Sign out</button>
        </Authenticator>
    );
}

export default App;
