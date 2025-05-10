const AWS = require('aws-sdk');
const ecs = new AWS.ECS();

exports.handler = async (event) => {
    try {
        console.log("Received SNS event:", JSON.stringify(event));

        const snsMessage = JSON.parse(event.Records[0].Sns.Message);
        const url = snsMessage.url;

        if (!url) {
            throw new Error("Missing 'url' in SNS message");
        }

        const params = {
            cluster: "moroClaster",
            launchType: "FARGATE",
            taskDefinition: "mirobot",
            count: 1,
            platformVersion: "LATEST",
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: ["subnet-0153900c2b1204bdb"],
                    securityGroups: ["subnet-0995a738220b53453"],
                    assignPublicIp: "ENABLED"
                }
            },
            overrides: {
                containerOverrides: [
                    {
                        name: "miro-bot",
                        environment: [
                            {
                                name: "URL",
                                value: url
                            }
                        ]
                    }
                ]
            }
        };

        const result = await ecs.runTask(params).promise();
        console.log("ECS task started:", JSON.stringify(result.tasks));

        return {
            statusCode: 200,
            body: "Task started"
        };
    } catch (error) {
        console.error("Error starting ECS task:", error);
        throw error;
    }
};
