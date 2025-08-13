data "aws_region" "current_region" {}

data "aws_ecr_repository" "bot_repo" {
  name = var.ecr_repo_name
}

data "aws_ecr_image" "latest_image" {
  repository_name = "miro-talk-bot"
  most_recent     = true
}

data "aws_vpc" "main_vpc" {
  id = var.main_vpc_id
}