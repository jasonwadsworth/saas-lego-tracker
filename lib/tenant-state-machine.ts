import { Stack } from 'aws-cdk-lib';
import { AppsyncFunction, Code, FunctionRuntime, GraphqlApi, HttpDataSource, Resolver } from 'aws-cdk-lib/aws-appsync';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { DefinitionBody, LogLevel, StateMachine, StateMachineType } from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

interface Props {
    definitionBody: DefinitionBody;
    httpDataSource: HttpDataSource;
}

export class TenantStateMachine extends Construct {
    public readonly stateMachine: StateMachine;

    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id);

        const stack = Stack.of(this);

        const { definitionBody, httpDataSource } = props;

        this.stateMachine = new StateMachine(this, 'StateMachine', {
            definitionBody,
            stateMachineType: StateMachineType.EXPRESS,
            logs: {
                destination: new LogGroup(this, 'StateMachineLogGroup'),
                includeExecutionData: true,
                level: LogLevel.ALL,
            },
        });
        this.stateMachine.addToRolePolicy(
            new PolicyStatement({
                resources: [`arn:aws:iam::${stack.account}:role/tenant/*`], // allow all "tenant" roles by using the path to distinguish them
                actions: ['sts:AssumeRole'],
            }),
        );

        this.stateMachine.grant(httpDataSource.grantPrincipal, 'states:StartSyncExecution');
    }
}
