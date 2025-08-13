import json
import boto3
import logging

ecs = boto3.client('ecs')
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    try:

        sns_message = json.loads(event['Records'][0]['Sns']['Message'])
        url = sns_message.get('url')

        if not url:
            raise ValueError("Missing 'url' in SNS message")

        response = ecs.run_task(
            cluster="miro-talk-bot-claster",
            launchType="FARGATE",
            taskDefinition="experimental-miro-talk-bot-video-recorder",
            count=1,
            platformVersion="LATEST",
            networkConfiguration={
                'awsvpcConfiguration': {
                    'subnets': ['subnet-07e4ce464f47fef6d'],
                    'securityGroups': ['sg-0ca926c2de128a40d'],  # ⚠️ this looks like a subnet ID, double check
                    'assignPublicIp': 'ENABLED'
                }
            },
            overrides={
                'containerOverrides': [
                    {
                        'name': 'mirobot',
                        'environment': [
                            {
                                'name': 'URL',
                                'value': url
                            }
                        ]
                    }
                ]
            }
        )


        return {
            'statusCode': 200,
            'body': 'Task started'
        }

    except Exception as e:
        raise
