# tsds-typedoc

Internal TypeDoc command used by `ts-dev-stack`.

Install and configure `ts-dev-stack` to generate API documentation. See the
[ts-dev-stack documentation](https://www.npmjs.com/package/ts-dev-stack).

The command attempts to restore the original package installation after
documentation generation. It reports restoration failures so callers can detect
an installation that needs attention.
