import { gql, useMutation } from '@apollo/client';
import { useState } from 'react';

const ADD_SET = gql`
    mutation addSet($input: AddSet!) {
        addSet(input: $input) {
            id
            name
        }
    }
`;
export function AddSet() {
    const [mutation] = useMutation(ADD_SET);
    const [set, setSet] = useState({ id: '', name: '' });

    return (
        <div>
            <input
                type="text"
                onBlur={(e) => {
                    setSet((cur) => ({ ...cur, id: e.target.value }));
                }}
            />
            <input
                type="text"
                onBlur={(e) => {
                    setSet((cur) => ({ ...cur, name: e.target.value }));
                }}
            />
            <button
                onClick={() => {
                    mutation({ variables: { input: set } });
                }}
            >
                Add
            </button>
        </div>
    );
}
