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
  default = "vpc-029433628e702ccd1"
}

variable "subnet_id" {
  default = "subnet-07e4ce464f47fef6d"
}

variable "sg_id" {
  default = "sg-0ca926c2de128a40d"
}

variable "lambda_zip_exists" {
  type    = bool
  default = true
}

variable "bot_queue_name" {
  default = "videoRecordingQueueDev"
}