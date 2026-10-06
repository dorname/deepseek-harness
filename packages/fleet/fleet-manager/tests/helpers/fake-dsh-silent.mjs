// A process that stays alive and never prints a URL, for the readiness
// timeout test. A separate script file (not `node -e`) because the
// production spawner appends `--port 0`, which Node's CLI would reject as a
// flag in `-e` mode but passes through to a script file.
setInterval(() => {}, 1000)
