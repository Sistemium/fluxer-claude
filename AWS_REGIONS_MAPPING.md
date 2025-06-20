# AWS Regions Mapping для Spot Instances

## Поддерживаемые регионы для g6e.xlarge/2xlarge

| Регион | AMI ID | Subnet ID | Security Group | Spot Цена g6e.xlarge | Статус |
|--------|--------|-----------|----------------|---------------------|--------|
| **eu-central-1** | `ami-0f79e56a397d891ea` | `subnet-4946a720` | `sg-0a1780cb65e71f7b2` | $0.71/час | ✅ Текущий |
| **eu-west-1** | `ami-0b8e87449cf49f945` | `❓ subnet-XXXXXXXXX` | `❓ sg-XXXXXXXXX` | ❌ Недоступно | ❌ g6e недоступны |
| **eu-north-1** | `ami-0f27a45026f780e63` | `❓ subnet-XXXXXXXXX` | `❓ sg-XXXXXXXXX` | $1.11/час | ✅ Доступен |
| **eu-south-1** | ❌ AMI недоступно | `❓ subnet-XXXXXXXXX` | `❓ sg-XXXXXXXXX` | ❌ Недоступно | ❌ |
| **eu-west-2** | `ami-0ac314941d6c50027` | `❓ subnet-XXXXXXXXX` | `❓ sg-XXXXXXXXX` | ❌ Недоступно | ❌ g6e недоступны |
| **eu-west-3** | `ami-0885d51c79d516f7d` | `❓ subnet-XXXXXXXXX` | `❓ sg-XXXXXXXXX` | ❌ Недоступно | ❌ g6e недоступны |

## Deep Learning AMI образы по регионам

### Ubuntu 22.04 + PyTorch (для g6e.*)
```bash
# eu-central-1 (Frankfurt)
aws ec2 describe-images --region eu-central-1 --owners amazon \
  --filters "Name=name,Values=Deep Learning AMI GPU PyTorch*Ubuntu 22.04*" \
  --query 'Images[0].ImageId' --output text

# eu-west-1 (Ireland) 
aws ec2 describe-images --region eu-west-1 --owners amazon \
  --filters "Name=name,Values=Deep Learning AMI GPU PyTorch*Ubuntu 22.04*" \
  --query 'Images[0].ImageId' --output text

# eu-north-1 (Stockholm)
aws ec2 describe-images --region eu-north-1 --owners amazon \
  --filters "Name=name,Values=Deep Learning AMI GPU PyTorch*Ubuntu 22.04*" \
  --query 'Images[0].ImageId' --output text
```

## Instance Types по регионам

### g6e.xlarge (24GB VRAM, 32GB RAM)
- ✅ eu-central-1 (Frankfurt) - протестировано
- ❓ eu-west-1 (Ireland) - нужно проверить
- ❓ eu-north-1 (Stockholm) - нужно проверить

### g6e.2xlarge (48GB VRAM, 64GB RAM) 
- ✅ eu-central-1 (Frankfurt) - текущий выбор
- ❓ eu-west-1 (Ireland) - нужно проверить
- ❓ eu-north-1 (Stockholm) - нужно проверить

## Spot Instance доступность

### Проверка доступности
```bash
# Проверить цены spot в регионе
aws ec2 describe-spot-price-history \
  --region eu-central-1 \
  --instance-types g6e.xlarge g6e.2xlarge \
  --product-descriptions "Linux/UNIX" \
  --max-items 10

# Проверить доступные зоны
aws ec2 describe-availability-zones --region eu-central-1
```

## Быстрое переключение региона

### .env.local конфигурации

#### ✅ eu-central-1 (Frankfurt) - текущая ($0.71/час)
```bash
SPOT_AWS_REGION=eu-central-1
SPOT_AMI_ID=ami-0f79e56a397d891ea
SPOT_INSTANCE_TYPE=g6e.2xlarge
AWS_SUBNET_ID=subnet-4946a720
AWS_SECURITY_GROUP_ID=sg-0a1780cb65e71f7b2
SPOT_MAX_PRICE=1.20
```

#### ✅ eu-north-1 (Stockholm) - альтернатива ($1.11/час)
```bash
SPOT_AWS_REGION=eu-north-1
SPOT_AMI_ID=ami-0f27a45026f780e63
SPOT_INSTANCE_TYPE=g6e.2xlarge
AWS_SUBNET_ID=❓ TODO
AWS_SECURITY_GROUP_ID=❓ TODO
SPOT_MAX_PRICE=1.50
```

#### ❌ eu-west-1 (Ireland) - g6e недоступны
```bash
# g6e instance types недоступны в eu-west-1
# Используйте g5.xlarge как альтернативу
```

## Инфраструктурные зависимости

### Централизованные сервисы (eu-west-1)
- ✅ HuggingFace Token (Secrets Manager)
- ✅ SQS Queue
- ✅ S3 Bucket
- ✅ EventBridge

### Региональные сервисы
- VPC, Subnets, Security Groups - в каждом регионе отдельно
- Key Pairs - в каждом регионе отдельно

## TODO: Заполнить

1. **Найти AMI ID** для каждого региона
2. **Создать VPC ресурсы** в нужных регионах  
3. **Создать Key Pairs** в каждом регионе
4. **Протестировать spot доступность** в разных регионах
5. **Автоматизировать переключение** между регионами

---
*Обновлено: 2025-06-20*