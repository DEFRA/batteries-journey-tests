#!/bin/sh

# Entry point for CDP Portal runs.
#   ENVIRONMENT  — CDP environment to test (dev, test, perf-test, ...)
#   PROFILE      — optional; filters tests by title or @tag (Playwright grep)
#   BROWSER      — optional; chromium (default), firefox or webkit
# RUN_MODE defaults to e2e (deployed services); override it to run the image
# against a local Compose stack.

echo "run_id: $RUN_ID"
echo "environment: $ENVIRONMENT profile: ${PROFILE:-<all>} browser: ${BROWSER:-chromium}"

export RUN_MODE="${RUN_MODE:-e2e}"

npx playwright test
test_exit_code=$?

./bin/publish-tests.sh
publish_exit_code=$?

if [ $publish_exit_code -ne 0 ]; then
  echo "failed to publish test results"
  exit $publish_exit_code
fi

if [ $test_exit_code -ne 0 ]; then
  echo "test suite failed"
  exit $test_exit_code
fi

echo "test suite passed"
exit 0
