variable "aws_region" {
  default = "eu-north-1"
}

variable "cluster_name" {
  default = "miro-talk-bot-claster"
}

variable "task_family" {
  default = "experimental-miro-talk-bot-video-recorder"
}

variable "ecr_repo_name" {
  default = "miro-talk-bot"
}

variable "lambda_function_name" {
  default = "video-recorder-bot-trigger"
}

variable "s3_bucket_name" {
  description = "S3 bucket name"
  type        = string
  default     = "skillzzy-video"
}

variable "main_vpc_id" {
  default = "vpc-0032e90317069a534"
}

variable "subnet_id" {
  default = "subnet-0b6df8f042c39ef90"
}

variable "sg_id" {
  default = "sg-00e66c9ea2568e5f8"
}

variable "lambda_zip_exists" {
  type    = bool
  default = true
}

variable "bot_queue_name" {
  default = "videoRecordingQueueDev"
}