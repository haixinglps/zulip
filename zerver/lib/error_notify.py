# System documented in https://zulip.readthedocs.io/en/latest/subsystems/logging.html
from collections import defaultdict
from typing import Any, Dict

from django.core.mail import mail_admins

from zerver.filters import clean_data_from_query_parameters


def do_report_error(report: Dict[str, Any]) -> None:
    report = defaultdict(lambda: None, report)

    topic = "{node}: {message}".format(**report).replace("\n", "\\n").replace("\r", "\\r")

    logger_str = "Logger {logger_name}, from module {log_module} line {log_lineno}:".format(
        **report
    )

    if report.get("user") and report["user"].get("user_full_name"):
        user_info = "{user[user_full_name]} <{user[user_email]}> ({user[user_role]})".format(
            **report
        )
    else:
        user_info = "Anonymous user (not logged in)"
    user_info += " on {host} deployment".format(**report)

    deployment = "Deployed code:\n"
    for field, val in report["deployment_data"].items():
        deployment += f"- {field}: {val}\n"

    if report["has_request"]:
        request_repr = """\
Request info:
- path: {path}
- {method}: {data}
""".format(
            **report
        )
        for field in ["REMOTE_ADDR", "QUERY_STRING", "SERVER_NAME"]:
            val = report.get(field.lower())
            if field == "QUERY_STRING":
                val = clean_data_from_query_parameters(str(val))
            request_repr += f'- {field}: "{val}"\n'
    else:
        request_repr = "Request info: none\n"

    message = f"""\
{logger_str}
Error generated by {user_info}

{report['stack_trace']}

{deployment}

{request_repr}"""

    mail_admins(topic, message, fail_silently=True)
