#!/bin/bash

echo "=== Поиск Deep Learning AMI в европейских регионах ==="
echo ""

REGIONS=("eu-central-1" "eu-west-1" "eu-north-1" "eu-south-1" "eu-west-2" "eu-west-3")

echo "| Регион | AMI ID | Описание |"
echo "|--------|--------|----------|"

for region in "${REGIONS[@]}"; do
    echo -n "| $region | "
    
    # Найти последний Deep Learning AMI с PyTorch для Ubuntu 22.04
    ami_id=$(aws ec2 describe-images \
        --region "$region" \
        --owners amazon \
        --filters \
            "Name=name,Values=*Deep Learning*PyTorch*22.04*" \
            "Name=state,Values=available" \
        --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
        --output text 2>/dev/null)
    
    if [ "$ami_id" != "None" ] && [ "$ami_id" != "" ]; then
        # Получить название AMI
        ami_name=$(aws ec2 describe-images \
            --region "$region" \
            --image-ids "$ami_id" \
            --query 'Images[0].Name' \
            --output text 2>/dev/null | cut -d' ' -f1-6)
        
        echo "$ami_id | $ami_name |"
    else
        echo "❌ Недоступно | - |"
    fi
done

echo ""
echo "=== Проверка spot доступности g6e instances ==="
echo ""

echo "| Регион | g6e.xlarge Цена | g6e.2xlarge Цена | Статус |"
echo "|--------|-----------------|------------------|--------|"

for region in "${REGIONS[@]}"; do
    echo -n "| $region | "
    
    # Проверить цены spot для g6e.xlarge
    xlarge_price=$(aws ec2 describe-spot-price-history \
        --region "$region" \
        --instance-types g6e.xlarge \
        --product-descriptions "Linux/UNIX" \
        --max-items 1 \
        --query 'SpotPriceHistory[0].SpotPrice' \
        --output text 2>/dev/null)
    
    # Проверить цены spot для g6e.2xlarge  
    xxlarge_price=$(aws ec2 describe-spot-price-history \
        --region "$region" \
        --instance-types g6e.2xlarge \
        --product-descriptions "Linux/UNIX" \
        --max-items 1 \
        --query 'SpotPriceHistory[0].SpotPrice' \
        --output text 2>/dev/null)
    
    if [ "$xlarge_price" != "None" ] && [ "$xlarge_price" != "" ]; then
        echo -n "\$$xlarge_price | "
    else
        echo -n "❌ | "
    fi
    
    if [ "$xxlarge_price" != "None" ] && [ "$xxlarge_price" != "" ]; then
        echo -n "\$$xxlarge_price | "
    else
        echo -n "❌ | "
    fi
    
    # Статус доступности
    if [ "$xlarge_price" != "None" ] && [ "$xlarge_price" != "" ]; then
        echo "✅ Доступно |"
    else
        echo "❌ Недоступно |"
    fi
done

echo ""
echo "=== Команды для обновления .env.local ==="
echo ""
echo "# Пример для переключения на eu-west-1:"
echo "# SPOT_AWS_REGION=eu-west-1"
echo "# SPOT_AMI_ID=ami-xxxxxxxxx"
echo "# AWS_SUBNET_ID=subnet-xxxxxxxxx" 
echo "# AWS_SECURITY_GROUP_ID=sg-xxxxxxxxx"
echo ""
echo "Проверьте наличие VPC ресурсов в целевом регионе!"