# AWS EC2 Events → MQTT Monitoring Plan

## Цель
Получать события EC2 Spot Fleet и инстансов через MQTT без polling для мониторинга с ноутбука и продакшен бекенда.

## Архитектура
```
AWS EventBridge → Lambda Function → MQTT Broker
```

## События для отслеживания

### Spot Fleet Events
- `EC2 Spot Fleet Request State-change` - состояние fleet запроса
- `EC2 Spot Fleet Instance Terminated` - завершение инстанса во fleet

### EC2 Instance Events  
- `EC2 Instance State-change Notification` - изменения состояния инстанса
- `EC2 Spot Instance Interruption Warning` - предупреждение за 2 минуты

## MQTT Topics Structure
```
fluxer/aws/spot-fleet/{fleet-id}/created
fluxer/aws/spot-fleet/{fleet-id}/active
fluxer/aws/spot-fleet/{fleet-id}/cancelled
fluxer/aws/spot-fleet/{fleet-id}/capacity-change

fluxer/aws/instances/{instance-id}/pending
fluxer/aws/instances/{instance-id}/running  
fluxer/aws/instances/{instance-id}/stopping
fluxer/aws/instances/{instance-id}/terminated
fluxer/aws/instances/{instance-id}/spot-interruption
```

## Реализация

### 1. Lambda Function (aws-events-to-mqtt)
```javascript
exports.handler = async (event) => {
  // Parse EventBridge event
  const source = event.source; // aws.ec2
  const detailType = event['detail-type'];
  const detail = event.detail;
  
  // Format MQTT message
  const mqttTopic = formatTopic(detailType, detail);
  const mqttMessage = {
    timestamp: event.time,
    region: event.region,
    source: source,
    detail: detail
  };
  
  // Send to MQTT broker
  await sendToMQTT(mqttTopic, mqttMessage);
};
```

### 2. EventBridge Rules
- Rule 1: EC2 Spot Fleet events
- Rule 2: EC2 Instance state changes  
- Rule 3: Spot interruption warnings
- Target: Lambda function

### 3. Backend MQTT Subscription
```typescript
// Subscribe to AWS events
mqtt.subscribe('fluxer/aws/+/+/+');
mqtt.subscribe('fluxer/aws/instances/+/+');
```

## Преимущества
- ✅ Мгновенные уведомления без polling
- ✅ Работает с любой сети (ноутбук/продакшн)
- ✅ Единый MQTT поток для всех AWS событий
- ✅ Можно подписаться на конкретные инстансы
- ✅ Spot interruption warnings за 2 минуты
- ✅ Fleet capacity monitoring

## Шаги реализации
1. Создать Lambda функцию aws-events-to-mqtt
2. Настроить EventBridge Rules
3. Добавить MQTT подписки в бекенд
4. Обработчики AWS событий в SpotInstanceService
5. UI обновления в реальном времени

## Environment Variables для Lambda
- MQTT_BROKER_HOST
- MQTT_BROKER_PORT  
- MQTT_USERNAME (если нужен)
- MQTT_PASSWORD (если нужен)