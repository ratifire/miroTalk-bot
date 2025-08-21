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
        file_name = sns_message.get('fileName')

        if not url or not file_name:
            raise ValueError("Missing 'url' or 'fileName' in SNS message")

        response = ecs.run_task(
            cluster="miro-talk-bot-claster",
            launchType="FARGATE",
            taskDefinition="experimental-miro-talk-bot-video-recorder",
            count=1,
            platformVersion="LATEST",
            networkConfiguration={
                'awsvpcConfiguration': {
                    'subnets': ['subnet-0b6df8f042c39ef90'],
                    'securityGroups': ['sg-00e66c9ea2568e5f8'],  # ⚠️ this looks like a subnet ID, double check
                    'assignPublicIp': 'ENABLED'
                }
            },
            overrides={
                'containerOverrides': [
                    {
                        'name': 'mirobot',
                        'environment': [
                            {'name': 'URL', 'value': url},
                            {'name': 'FILENAME', 'value': file_name}
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
