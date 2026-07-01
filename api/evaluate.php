<?php
// api/evaluate.php — server-side proxy for the Typesafe AI.
//
// The browser calls THIS same-origin endpoint instead of api.typesafe.ai
// directly (see typesafe.js). Routing through our own server solves two things:
//   1. CORS — Typesafe only answers browser calls from origins on its allowlist;
//      a server-to-server call sidesteps that entirely.
//   2. Key secrecy — the API key never leaves the server, so it's never shipped
//      to, or visible in, the browser.
//
// KEY SOURCE (set one before deploying):
//   • the TYPESAFE_API_KEY environment variable (preferred — set it in cPanel /
//     your host's config), or
//   • ../typesafe_key.txt read from disk. That file is blocked from web access
//     by .htaccess, but PHP can still read it server-side.
//
// Requires the cURL PHP extension (standard on cPanel/shared hosting).

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// Resolve the API key without ever exposing it to the client.
$key = getenv('TYPESAFE_API_KEY');
if (!$key) {
    $keyFile = __DIR__ . '/../typesafe_key.txt';
    if (is_readable($keyFile)) {
        $key = trim(file_get_contents($keyFile));
    }
}
if (!$key) {
    http_response_code(500);
    echo json_encode(['error' => 'Server is missing the Typesafe API key. Set TYPESAFE_API_KEY or provide typesafe_key.txt.']);
    exit;
}

// The browser sends the request already in Typesafe's shape (document/model/
// prompts). Validate lightly so this can't be used as an open relay for
// arbitrary calls, then forward it verbatim.
$body = file_get_contents('php://input');
$decoded = json_decode($body, true);
if (!is_array($decoded) || !isset($decoded['document']) || !isset($decoded['prompts'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid request body']);
    exit;
}

$ch = curl_init('https://api.typesafe.ai/preview/evaluation');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $key,
        'Content-Type: application/json',
    ],
]);
$response = curl_exec($ch);
if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Upstream request failed: ' . curl_error($ch)]);
    curl_close($ch);
    exit;
}
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

// Mirror Typesafe's status + body back to the browser unchanged.
http_response_code($status ?: 502);
echo $response;
