import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, AppSyncAuthorizerEvent, AppSyncAuthorizerResult, Context } from 'aws-lambda';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
export const handler = async (event: APIGatewayProxyEventV2, context: Context): Promise<APIGatewayProxyResultV2> => {
    console.log(event);

    const { host } = event.headers;

    if (!host) return { statusCode: 400 };

    const response = await dynamodb.send(
        new GetCommand({
            Key: { pk: 'Host', sk: host },
            TableName: process.env.TABLE_NAME,
        }),
    );

    if (!response.Item) return { statusCode: 404 };
    const { pk, sk, ...rest } = response.Item;
    return rest;
};
