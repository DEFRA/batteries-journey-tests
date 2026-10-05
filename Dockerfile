# Playwright's image ships Chromium, Firefox and WebKit with their OS
# dependencies, so BROWSER can be switched at run time on the CDP Portal.
# Keep the tag in step with @playwright/test in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV TZ="Europe/London"

USER root

RUN apt-get update -qq \
    && apt-get install -qqy --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*

# AWS CLI, used by bin/publish-tests.sh to upload the report.
RUN curl -fsS "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o awscliv2.zip \
    && unzip -q awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
# --ignore-scripts blocks install-time scripts for this package and every
# dependency (belt-and-braces with .npmrc's ignore-scripts=true).
RUN npm ci --ignore-scripts

COPY . .

ENTRYPOINT [ "./entrypoint.sh" ]
