# Journey flow files

One file per complete user journey. Each file lists **every** branch of the
journey — including ones not built yet — with a status marker, so the gap
between the services and the test suite is visible at a glance.

## Journeys

| Journey   | File               | Owning frontend(s)                            | E2E specs                 |
| --------- | ------------------ | --------------------------------------------- | ------------------------- |
| Home page | [home.md](home.md) | registration (submissions, obligations noted) | `tests/specs/home.e2e.js` |

Add a row when a new journey file is created.

## Status markers

| Marker              | Meaning                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `[IMPLEMENTED]`     | Built in the owning frontend; E2E test written or ready to write       |
| `[BLOCKED: reason]` | Built in the frontend but E2E is blocked — state the observable reason |
| `[PLANNED]`         | Not yet built in the frontend                                          |

After an `[IMPLEMENTED]` marker, note the coverage:
`— E2E: tests/specs/<file>.e2e.js` when a test exists, or `— E2E: not written`,
or `— E2E: descoped (<covering test>)` after a coverage-gap analysis.

## Maintenance rule

Flow files are updated **before** test code is touched. When a feature lands:

1. Update the marker.
2. Correct headings, page titles, field labels and routing to match the source.
3. Then write (or descope) the test.

## Ground truth

The frontend source of the owning service is authoritative:

- `../waste-batteries-reg-frontend/src`
- `../waste-batteries-submit-frontend/src`
- `../waste-batteries-obligations-fe/src`

When a flow file disagrees with source, source wins and the flow file is
updated. Each file records the commit it was last checked against.

## Journey file template

```markdown
# <Journey name>

**Owning frontend:** <repo> · **Entry point:** `<route>`
**Last checked against source:** <repo>@<short sha> on <YYYY-MM-DD>

## Steps

1. **<Page title>** (`GET <route>`) [IMPLEMENTED] — E2E: <file or "not written">
   - Heading: "<h1 text>"; title: "<pageTitle> | <serviceName>"
   - Fields: "<label>" (<type>, <validation>)
   - Continue → <next route>
   - **Branch — <condition>:** → <route> [PLANNED]
2. ...

## Error branches

- <trigger> → <message> [IMPLEMENTED] — E2E: <...>

## Notes

- <exclusions, design references, Jira tickets>
```
