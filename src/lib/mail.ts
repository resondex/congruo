import 'server-only'

/**
 * Sending mail.
 *
 * One interface, two transports, chosen by whether the environment is
 * configured. Everything that sends goes through here rather than reaching for
 * a provider, so adding a second provider - or discovering the first one is
 * unreachable - is one file.
 *
 * When nothing is configured the message is logged instead of sent. That is
 * what makes the forgot-password flow developable before a sending domain
 * exists, and it is deliberately loud: a silent no-op would look like a
 * delivery problem for as long as it took someone to check.
 */

export interface Message {
  to: string
  subject: string
  text: string
}

function configured() {
  return Boolean(
    process.env.AWS_REGION &&
      process.env.MAIL_FROM &&
      (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE)
  )
}

export function mailConfigured() {
  return configured()
}

/**
 * Sends, or logs when there is nowhere to send from.
 *
 * Never throws. Callers are flows like "forgot my password", where a failure
 * to send must not turn into a different response than a success - the
 * response has to look the same either way or it becomes a way to ask whether
 * an address is registered.
 */
export async function send(message: Message): Promise<{ sent: boolean }> {
  if (!configured()) {
    console.warn(
      `[mail] not configured, logging instead\n  to: ${message.to}\n  subject: ${message.subject}\n\n${message.text}\n`
    )
    return { sent: false }
  }

  try {
    // Imported here rather than at the top so the SDK is not loaded - or
    // required to be installed - on a deployment that sends no mail.
    const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2')
    const client = new SESv2Client({ region: process.env.AWS_REGION })
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: process.env.MAIL_FROM,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject },
            Body: { Text: { Data: message.text } },
          },
        },
      })
    )
    return { sent: true }
  } catch (error) {
    console.error('[mail] send failed', error)
    return { sent: false }
  }
}
