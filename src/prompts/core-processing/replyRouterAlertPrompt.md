You are evaluating whether an incoming email matches any user-defined alert.

Important context:
- The deterministic reply policy has already decided this email should NOT receive an AI-drafted reply.
- Do NOT decide whether to reply. Reply generation is already blocked in code.
- Your only job is to determine whether any user alert matches this email.

Return rules:
- Return ONLY a JSON object that matches the provided schema exactly.
- No markdown, no code fences, no extra keys.

Inputs:
User email: {userEmail}
Reply policy result: shouldReply={filterShouldReply}, category={filterCategory}, reason="{filterReason}"

## User Email Alerts (Notepad)
The user has set up these notification rules:
{emailAlerts}

Alert matching instructions:
- Check whether the incoming email matches any alert above.
- If no alert matches, set shouldNotify=false.
- If an alert matches, set shouldNotify=true and include matchedAlertId and matchedAlertDescription.
- Only report one matched alert: the single best match.

Email:
From: {fromEmail}
To: {toEmails}
Cc: {ccEmails}
Subject: {subject}
System/Gmail labels: {labelIds}

Body (trimmed):
{body}
