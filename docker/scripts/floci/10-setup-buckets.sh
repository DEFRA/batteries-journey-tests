#!/bin/bash

# Runs inside floci on startup (/etc/floci/init/start.d). The aws CLI picks up
# AWS_ENDPOINT_URL / AWS_REGION from docker/config/defaults.env.

# cdp-uploader: quarantine bucket (uploads land here before the virus scan) and
# the consumer bucket clean files are copied to.
aws s3 mb s3://cdp-uploader-quarantine
aws s3 mb s3://batteries-uploads

# cdp-uploader: SQS queues
aws sqs create-queue --queue-name cdp-clamav-results
aws sqs create-queue --queue-name cdp-uploader-download-requests
aws sqs create-queue --queue-name cdp-uploader-scan-results-callback.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true

# Queue polled by cdp-uploader's mock ClamAV (MOCK_VIRUS_SCAN_ENABLED=true),
# fed by S3 events on the quarantine bucket.
aws sqs create-queue --queue-name mock-clamav

queue_arn=$(aws sqs get-queue-attributes \
  --queue-url "$AWS_ENDPOINT_URL/000000000000/mock-clamav" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text)

aws s3api put-bucket-notification-configuration \
  --bucket cdp-uploader-quarantine \
  --notification-configuration "{
    \"QueueConfigurations\": [{
      \"QueueArn\": \"$queue_arn\",
      \"Events\": [\"s3:ObjectCreated:*\"]
    }]
  }"

# Add service-specific S3 buckets / SQS queues / SNS topics below.
