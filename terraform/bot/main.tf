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
  handler       = "main.lambda_handler"
  runtime       = "python3.12"
  filename      = "${path.module}/../lambda/lambda.zip"
  # source_code_hash = filebase64sha256("${path.module}/../lambda/lambda.zip")
  timeout = 30

  environment {
    variables = {
      ECS_CLUSTER       = var.cluster_name
      TASK_DEF          = var.task_family
      SUBNET_ID         = var.subnet_id
      SECURITY_GROUP_ID = var.sg_id
    }
  }

  lifecycle {
    create_before_destroy = true
    ignore_changes        = [source_code_hash]
  }
}

resource "aws_sqs_queue" "matcher_participant" {
  name                       = var.bot_queue_name
  visibility_timeout_seconds = 30
  delay_seconds              = 0
  message_retention_seconds  = 86400
}

resource "aws_security_group" "vpce" {
  name        = "vpce-endpoints"
  description = "Allow HTTPS from ECS tasks"
  vpc_id      = var.main_vpc_id

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [var.sg_id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ECR API endpoint
resource "aws_vpc_endpoint" "ecr_api" {
  vpc_id              = var.main_vpc_id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [var.subnet_id]
  security_group_ids  = [aws_security_group.vpce.id]
  private_dns_enabled = true
}

# ECR DKR endpoint
resource "aws_vpc_endpoint" "ecr_dkr" {
  vpc_id              = var.main_vpc_id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [var.subnet_id]
  security_group_ids  = [aws_security_group.vpce.id]
  private_dns_enabled = true
}

data "aws_route_table" "subnet_rt" {
  subnet_id = var.subnet_id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = var.main_vpc_id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [data.aws_route_table.subnet_rt.id]
}