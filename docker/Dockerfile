# /*********************************************************************************************************************
# *  Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.                                           *
# *                                                                                                                    *
# *  Licensed under the Amazon Software License (the "License"). You may not use this file except in compliance        *
# *  with the License. A copy of the License is located at                                                             *
# *                                                                                                                    *
# *      http://aws.amazon.com/asl/                                                                                    *
# *                                                                                                                    *
# *  or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES *
# *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
# *  and limitations under the License.                                                                                *
# **********************************************************************************************************************/

from public.ecr.aws/docker/library/python:latest

# Install AWS dependencies
RUN pip install boto3 

# Install labeling tool and it's dependencies.
RUN pip install doccano
RUN pip install 'doccano[postgresql]'
RUN pip install psycopg psycopg2

# Copy scipts.
COPY start.sh /start.sh
COPY get_secret.py /get_secret.py

# Set working directory and entry point.
WORKDIR /
ENTRYPOINT ["/bin/bash", "./start.sh"]