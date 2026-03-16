const { spawn } = require('child_process');

const proc = spawn('npx', ['drizzle-kit', 'push'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    shell: true
});

proc.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output);

    if (output.includes('created or renamed from another column?')) {
        // Option 1 default is '+ confVslSeen create column'. We press enter.
        proc.stdin.write('\r\n');
    }

    if (output.includes('Do you still want to push changes?') || output.includes('You are about to execute current statements:')) {
        // Option 1 is 'No, abort'. Option 2 is 'Yes, I want to execute all statements'.
        // Press down arrow then enter.
        proc.stdin.write('\x1b[B\r\n');
    }
});

proc.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
    process.exit(code);
});
