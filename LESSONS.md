# Важные уроки проекта Fluxer

## 🚨 КРИТИЧЕСКИ ВАЖНО

### Конфигурация дисков
- **НЕ ТРОГАТЬ** размеры дисков без явного запроса пользователя
- Пользователь сам знает, какая конфигурация дисков нужна
- FLUX.1-dev весит ~24GB - учитывать при планировании места

### FLUX.1-dev модель
- **НИКОГДА не предлагать** заменить на упрощенную модель (SDXL, FLUX.1-schnell)
- Всегда искать решения для оптимизации FLUX.1-dev, а не замены

## ⚡ Производительность и память

### g5.xlarge ограничения
- 24GB VRAM + 16GB RAM часто НЕ ХВАТАЕТ для FLUX.1-dev
- OOM killer убивает процессы при нехватке RAM
- xformers КОНФЛИКТУЕТ с FLUX (TypeError, UnboundLocalError)

### FLUX оптимизации
- **НЕ использовать**: xformers с FLUX (вызывает ошибки в Diffusers ≥ 0.31)
- **НЕ использовать**: sequential_cpu_offload (медленно ~60+ сек/шаг) 
- **НЕ использовать**: model_cpu_offload если можно избежать
- **Использовать**: torch.bfloat16 лучше чем float16
- **Использовать**: low_cpu_mem_usage=True всегда

### inf2.xlarge преимущества
- 32GB Inferentia2 память (больше чем 24GB CUDA)
- $0.76/hr vs $1.006/hr (24% дешевле g5.xlarge)
- torch-neuronx нужно устанавливать из официального Neuron репозитория
- accelerate может КОНФЛИКТОВАТЬ с Neuron - можно отключить

## 🖥️ Операционные системы

### Ubuntu vs Amazon Linux
- **Ubuntu**: apt-get, ubuntu user, /home/ubuntu
- **Amazon Linux**: yum, ec2-user user, /home/ec2-user  
- **AMI выбор**: пользователь сам выбирает AMI, не менять без запроса

### Neuron SDK на inf2
- aws-neuronx-runtime-lib ОБЯЗАТЕЛЕН для torch-neuronx
- GPG ключи часто не работают - использовать --nogpgcheck
- Neuron runtime обычно предустановлен на inf2 AMI

## 📁 Файловая система

### Instance Store vs EBS
- Instance Store НЕЛЬЗЯ снапшотить (эфемерный)
- Только EBS тома можно снапшотить
- inf2 имеет NVMe диски для моделей

### HuggingFace кэш
- По умолчанию: ~/.cache/huggingface/
- Можно переопределить: HUGGINGFACE_HUB_CACHE
- Недозагруженные модели занимают место - чистить при OOM

## 🔧 Системная интеграция

### SystemD сервисы
- Правильный пользователь: ubuntu (Ubuntu) vs ec2-user (Amazon Linux)
- EnvironmentFile для переменных окружения
- WorkingDirectory должна существовать

### User Data скрипты
- AWS лимит: 16KB для User Data
- Решение: минимальный User Data + скачивание скрипта из Git
- Автоматический выбор скрипта по типу инстанса (inf2* vs GPU)

## 📝 Архитектурные решения

### Конфигурация и переменные окружения
- **НИКОГДА не хардкодить** значения в TypeScript/JavaScript код
- **ВСЕГДА использовать** .env.local или надежные хранилища (AWS Secrets Manager)
- AMI ID, токены, URL - только через переменные окружения
- Код должен падать если обязательные переменные не установлены

### Git vs S3 для кода
- Git лучше для кода AI сервиса (version control)
- S3 лучше для готовых изображений (не base64 в MongoDB/EventBridge)

### Spot Instance стратегия
- Custom AMI быстрее чем каждый раз устанавливать с нуля
- Deep Learning AMI как база (PyTorch, драйверы предустановлены)
- inf2 AMI уже содержит Neuron runtime

---
*Обновлено: $(date +%Y-%m-%d)*
*Помните: пользователь знает свою конфигурацию лучше!*