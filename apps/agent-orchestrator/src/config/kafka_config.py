"""
kafka_config.py — Kafka configuration and client factories for the RM Buddy
Agent Orchestrator service.

Uses aiokafka for async producer/consumer support, and pydantic-settings for
environment-based configuration (env prefix: KAFKA_).

Environment variables:
    KAFKA_BROKERS       Comma-separated broker list  (default: localhost:9092)
    KAFKA_CLIENT_ID     Client identifier            (default: rm-buddy-orchestrator)
    KAFKA_GROUP_ID      Consumer group ID            (default: orchestrator-group)
"""

from __future__ import annotations

import logging
from typing import Optional

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class KafkaSettings(BaseSettings):
    """
    Kafka settings resolved from environment variables at import time.

    All fields map to KAFKA_<FIELD_NAME> environment variables (case-insensitive)
    due to the env_prefix set in model_config.
    """

    brokers: str = "localhost:9092"
    client_id: str = "rm-buddy-orchestrator"
    group_id: str = "orchestrator-group"

    # ---------------------------------------------------------------------------
    # Topic names — override via env if topics are renamed in a deployment
    # ---------------------------------------------------------------------------
    ALERTS_GENERATED: str = "alerts.generated"
    AGENT_REQUEST: str = "agent.request"
    AGENT_RESPONSE: str = "agent.response"
    AUDIT_TRAIL: str = "audit.trail"

    model_config = {"env_prefix": "KAFKA_"}

    @property
    def broker_list(self) -> list[str]:
        """Return brokers as a list (aiokafka accepts a list or a single string)."""
        return [b.strip() for b in self.brokers.split(",") if b.strip()]


# Module-level singleton — imported by other modules as `from config.kafka_config import kafka_settings`
kafka_settings = KafkaSettings()


async def create_producer() -> AIOKafkaProducer:
    """
    Create and return a started AIOKafkaProducer instance.

    The caller is responsible for calling ``await producer.stop()`` when done,
    or using the producer as an async context manager:

        async with await create_producer() as producer:
            await producer.send_and_wait(topic, value)

    Returns:
        A started AIOKafkaProducer ready to publish messages.

    Raises:
        KafkaConnectionError: If the producer cannot connect to the brokers.
    """
    producer = AIOKafkaProducer(
        bootstrap_servers=kafka_settings.broker_list,
        client_id=kafka_settings.client_id,
        # Serialize values to UTF-8 bytes; callers must pass pre-serialised JSON strings.
        value_serializer=lambda v: v.encode("utf-8") if isinstance(v, str) else v,
        key_serializer=lambda k: k.encode("utf-8") if isinstance(k, str) else k,
        # Wait for leader acknowledgement — balances throughput vs. durability.
        acks="all",
        # Retry transient errors up to 5 times before raising.
        retry_backoff_ms=200,
    )
    await producer.start()
    logger.info(
        "Kafka producer started [client_id=%s, brokers=%s]",
        kafka_settings.client_id,
        kafka_settings.brokers,
    )
    return producer


async def create_consumer(group_id: Optional[str] = None) -> AIOKafkaConsumer:
    """
    Create and return a started AIOKafkaConsumer instance.

    The consumer is not subscribed to any topics yet; call
    ``consumer.subscribe([topic])`` after creation.

    Args:
        group_id: Override the default consumer group ID.  Useful when a
                  single service needs multiple isolated consumer groups.

    Returns:
        A started AIOKafkaConsumer ready to be subscribed and polled.

    Raises:
        KafkaConnectionError: If the consumer cannot connect to the brokers.
    """
    resolved_group_id = group_id or kafka_settings.group_id

    consumer = AIOKafkaConsumer(
        bootstrap_servers=kafka_settings.broker_list,
        client_id=kafka_settings.client_id,
        group_id=resolved_group_id,
        # Deserialize bytes to UTF-8 string; callers handle JSON parsing.
        value_deserializer=lambda v: v.decode("utf-8") if v is not None else None,
        key_deserializer=lambda k: k.decode("utf-8") if k is not None else None,
        # Start from the earliest unread message for the group; change to
        # "latest" if the orchestrator should only process new messages.
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        auto_commit_interval_ms=1000,
    )
    await consumer.start()
    logger.info(
        "Kafka consumer started [client_id=%s, group_id=%s, brokers=%s]",
        kafka_settings.client_id,
        resolved_group_id,
        kafka_settings.brokers,
    )
    return consumer
