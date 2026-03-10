#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# init-topics.sh — Create all Kafka topics for RM Buddy
#
# Usage:
#   KAFKA_HOST=broker:9092 ./init-topics.sh
#
# Environment variables:
#   KAFKA_HOST   Bootstrap server (default: localhost:9092)
#   KAFKA_BIN    Path to kafka bin directory (default: /opt/kafka/bin)
# ---------------------------------------------------------------------------

set -euo pipefail

KAFKA_HOST="${KAFKA_HOST:-localhost:9092}"
KAFKA_BIN="${KAFKA_BIN:-/opt/kafka/bin}"
KAFKA_TOPICS_CMD="${KAFKA_BIN}/kafka-topics.sh"

# ---------------------------------------------------------------------------
# Topic definitions: name|partitions|replication-factor
# ---------------------------------------------------------------------------
declare -a TOPICS=(
  "alerts.generated|3|1"
  "alerts.delivered|1|1"
  "alerts.acknowledged|1|1"
  "crm.sync.completed|1|1"
  "agent.request|3|1"
  "agent.response|3|1"
  "audit.trail|3|1"
)

echo "Using Kafka bootstrap server: ${KAFKA_HOST}"
echo "Using kafka-topics command:   ${KAFKA_TOPICS_CMD}"
echo ""

# ---------------------------------------------------------------------------
# Create topics
# ---------------------------------------------------------------------------
for entry in "${TOPICS[@]}"; do
  IFS='|' read -r TOPIC PARTITIONS REPLICATION <<< "${entry}"

  "${KAFKA_TOPICS_CMD}" \
    --create \
    --bootstrap-server "${KAFKA_HOST}" \
    --topic "${TOPIC}" \
    --partitions "${PARTITIONS}" \
    --replication-factor "${REPLICATION}" \
    --if-not-exists

  echo "OK: ${TOPIC} (partitions=${PARTITIONS}, replication=${REPLICATION})"
done

echo ""
echo "All 7 topics created successfully."
exit 0
