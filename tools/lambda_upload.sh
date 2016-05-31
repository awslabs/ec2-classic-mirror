#!/bin/bash
OPTIND=1

function usage() {
    echo "Usage: $0 [-p optional_prefix] [-r region] s3_bucket code_location"
    exit 0
}

optional_prefix=""
region=$(aws configure get region)
while getopts "h?p:r:" opt; do
    case "$opt" in
        h|\?)
            usage
            ;;
        p)
            optional_prefix=$OPTARG
            ;;
        r)
            region=$OPTARG
            ;;
    esac
done

shift $((OPTIND-1))
[ "$1" = "--" ] && shift

s3_bucket="$1"-"$region"
shift

code_location=$1
shift

[ -z "$s3_bucket" ] && usage
[ -z "$code_location" ] && usage

datestamp=$(date -u +%Y%m%d-%H%M%S)
s3_key=""
if [ ! -z $optional_prefix ]; then
    s3_key+=$optional_prefix"/"
fi
s3_key+=classicmirror-$datestamp
s3_key+=".zip"
echo $s3_key

s3_location=s3://$s3_bucket/$s3_key

TMP_ZIP_FILE=/tmp/classicmirror.zip
pushd $code_location && \
zip -r $TMP_ZIP_FILE index.js lib node_modules package.json &&
aws s3 cp $TMP_ZIP_FILE $s3_location --region $region && \
popd

if [ $? = 0 ]; then
    echo $s3_bucket
    echo $s3_key
fi

