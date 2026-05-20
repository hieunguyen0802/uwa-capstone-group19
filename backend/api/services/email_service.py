"""Email delivery helpers for workload distribution notifications.

Provides a fire-and-forget async send that runs in a daemon thread so that
the HTTP request can return immediately while SMTP work happens in the background.
A single shared SMTP connection is reused for the entire batch — reducing N
TCP handshakes to 1 when distributing to many recipients at once.
"""

import threading

from django.core.mail import EmailMessage, get_connection


def send_distribution_emails(notifications: list[dict]) -> None:
    """Send distribution notification emails over a single shared SMTP connection.

    Each dict in `notifications` must have keys: ``to``, ``subject``, ``body``.
    Items with an empty or missing ``to`` address are silently skipped.
    All exceptions are caught so that a broken SMTP session never surfaces to callers.
    """
    if not notifications:
        return
    connection = get_connection(fail_silently=True)
    try:
        connection.open()
        for n in notifications:
            recipient = n.get('to', '').strip()
            if not recipient:
                continue
            EmailMessage(
                subject=n['subject'],
                body=n['body'],
                to=[recipient],
                connection=connection,
            ).send()
    except Exception:
        pass
    finally:
        connection.close()


def send_distribution_emails_async(notifications: list[dict]) -> None:
    """Fire-and-forget wrapper: starts a daemon thread and returns immediately.

    The caller does not need to wait for email delivery — the HTTP response
    can be returned before any SMTP work begins.
    """
    if not notifications:
        return
    thread = threading.Thread(
        target=send_distribution_emails,
        args=(notifications,),
        daemon=True,
    )
    thread.start()
