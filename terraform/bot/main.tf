terraform {
  backend "s3" {}
}

provider "aws" {}

resource "aws_cloudwatch_log_group" "ecs_task_logs" {
  name              = "/ecs/${var.task_family}"
  retention_in_days = 14
}

resource "aws_ecs_task_definition" "video_recorder" {
  family                   = var.task_family
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  network_mode             = "awsvpc"

  execution_role_arn = aws_iam_role.ecs_execution_role.arn
  task_role_arn      = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "mirobot"
      image     = data.aws_ecr_image.latest_image.image_uri
      essential = true
      environment = [
        { name = "URL", value = "default" },
        { name = "S3", value = var.s3_bucket_name }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/mirobot"
          "awslogs-region"        = "eu-north-1"
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}


resource "aws_iam_role" "lambda_role" {
  name               = "${var.lambda_function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "lambda_ecs_policy" {
  role = aws_iam_role.lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecs:RunTask", "iam:PassRole"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "trigger_function" {
  function_name = var.lambda_function_name
  role          = aws_iam_role.lambda_role.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.12"
  filename      = "${path.module}/../lambda/lambda.zip"
  timeout       = 30
}

