data "aws_region" "current_region" {}

data "aws_ecr_image" "latest_image" {
  repository_name = var.ecr_repo_name
  most_recent     = true
}

data "aws_vpc" "main_vpc" {
  id = var.main_vpc_id
}

data "aws_subnets" "private_subnets" {
  filter {
    name   = "vpc-id"
    values = [var.main_vpc_id]
  }

  filter {
    name   = "tag:Type"
    values = ["private"]
  }

}

data "aws_route_tables" "private_route_tables" {
  filter {
    name   = "vpc-id"
    values = [var.main_vpc_id]
  }
}