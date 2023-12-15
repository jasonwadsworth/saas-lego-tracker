import { Stack } from 'aws-cdk-lib';
import { AppsyncFunction, Code, FunctionRuntime, GraphqlApi, HttpDataSource, Resolver } from 'aws-cdk-lib/aws-appsync';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import { join } from 'path';

interface Props {
    functionCode: Code;
    graphqlApi: GraphqlApi;
    httpDataSource: HttpDataSource;
    resolverTypeName: string;
    resolverFieldName: string;
    stateMachine: StateMachine;
}

export class AppSyncToStepFunction extends Construct {
    public readonly lambdaFunction: NodejsFunction;

    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id);

        const stack = Stack.of(this);

        const { functionCode, graphqlApi, httpDataSource, resolverFieldName, resolverTypeName, stateMachine } = props;

        const appsyncFunction = new AppsyncFunction(this, 'AppsyncFunction', {
            name: `${resolverTypeName}_${resolverFieldName}`,
            api: graphqlApi,
            dataSource: httpDataSource,
            code: functionCode,
            runtime: FunctionRuntime.JS_1_0_0,
        });

        const pipelineVars = JSON.stringify({
            STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        });

        new Resolver(this, 'Resolver', {
            api: graphqlApi,
            typeName: resolverTypeName,
            fieldName: resolverFieldName,
            code: Code.fromInline(`
            // The before step
            export function request(...args) {
              console.log(args);
              return ${pipelineVars}
            }

            // The after step
            export function response(ctx) {
              return ctx.prev.result
            }
          `),
            runtime: FunctionRuntime.JS_1_0_0,
            pipelineConfig: [appsyncFunction],
        });
    }
}
