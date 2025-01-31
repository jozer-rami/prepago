import { useRouter } from "next/router"
import AccountAbstraction from "@safe-global/account-abstraction-kit-poc"
import Safe, { EthersAdapter, getSafeContract } from "@safe-global/protocol-kit"
import { GelatoRelayPack } from "@safe-global/relay-kit"
import { OperationType } from "@safe-global/safe-core-sdk-types"
import { useQuery } from "@tanstack/react-query"
import { Wallet, constants, ethers } from "ethers"
import { getAddress, isAddress } from "ethers/lib/utils.js"
import { Loader2 } from "lucide-react"
import {
  useAccount,
  useChainId,
  useDisconnect,
  useMutation,
  useProvider,
} from "wagmi"

import { shortenAddress } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { LoginButton } from "@/components/LoginButton"

const relayPack = new GelatoRelayPack()

export default function CardPage() {
  const rawAddress = useRouter().query.address?.toString().toLowerCase() ?? ""
  const privateKey = useRouter().query.key?.toString()

  const provider = useProvider()

  const chainId = useChainId()

  const signer = privateKey ? new Wallet(privateKey, provider) : undefined

  const safeAddress = isAddress(rawAddress) ? getAddress(rawAddress) : undefined

  const { address: userAddress, isConnected } = useAccount()
  const { disconnect } = useDisconnect()

  const { data: isOwner, isLoading: ownershipLoading } = useQuery(
    ["isOwner", signer?.address],
    async () => {
      if (!signer || !safeAddress) throw new Error()

      const safe = await Safe.create({
        ethAdapter: new EthersAdapter({
          ethers,
          signerOrProvider: signer,
        }),
        safeAddress,
      })

      return safe.isOwner(signer.address)
    },
    { enabled: !!signer?.address }
  )

  const {
    mutate: claim,
    isLoading,
    data: relayTxId,
  } = useMutation(async () => {
    if (!signer || !safeAddress || !userAddress) throw new Error()

    const safeAccountAbstraction = new AccountAbstraction(signer)
    await safeAccountAbstraction.init({ relayPack })

    const ethAdapter = new EthersAdapter({
      ethers,
      signerOrProvider: signer,
    })

    const safe = await Safe.create({
      ethAdapter,
      safeAddress,
    })

    const swapOwnerTx = await safe.createSwapOwnerTx({
      oldOwnerAddress: signer.address,
      newOwnerAddress: userAddress,
    })

    console.log(swapOwnerTx)
    const signedSafeTx = await safe.signTransaction(swapOwnerTx)

    const contract = await getSafeContract({
      ethAdapter,
      safeVersion: await safe.getContractVersion(),
    })

    const encodedTransaction = contract.encode("execTransaction", [
      signedSafeTx.data.to,
      signedSafeTx.data.value,
      signedSafeTx.data.data,
      signedSafeTx.data.operation,
      signedSafeTx.data.safeTxGas,
      signedSafeTx.data.baseGas,
      signedSafeTx.data.gasPrice,
      signedSafeTx.data.gasToken,
      signedSafeTx.data.refundReceiver,
      signedSafeTx.encodedSignatures(),
    ])

    console.log("encoded", encodedTransaction)

    // const task = await relayPack.relayTransaction({
    //   target: safeAddress,
    //   encodedTransaction,
    //   chainId,
    //   options: {
    //     isSponsored: false,
    //     gasLimit: "150000",
    //     gasToken: constants.AddressZero,
    //   },
    // })

    const task = await relayPack.sendSyncTransaction(
      safeAddress,
      encodedTransaction,
      chainId,
      {
        isSponsored: false,
        gasLimit: "150000",
        gasToken: constants.AddressZero,
      }
    )

    return task.taskId
  })

  const { data: taskStatus } = useQuery(
    ["getTaskStatus", relayTxId],
    async () => {
      if (!relayTxId) throw new Error()

      return relayPack.getTaskStatus(relayTxId)
    },
    {
      enabled: !!relayTxId,
      refetchInterval(data) {
        if (
          data?.taskState &&
          [
            "ExecSuccess",
            "ExecReverted",
            "Blacklisted",
            "Cancelled",
            "NotFound",
          ].includes(data.taskState)
        ) {
          return false
        }

        return 1000
      },
    }
  )

  console.log(taskStatus)

  if (!safeAddress) {
    return (
      <div className="centered-container">
        <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
          Card address is not valid
        </h1>
      </div>
    )
  }

  if (!privateKey) {
    return (
      <div className="centered-container">
        <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
          Key is not valid
        </h1>
      </div>
    )
  }

  if (ownershipLoading) {
    return (
      <div className="centered-container">
        <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
          Loading…
        </h1>
      </div>
    )
  }

  if (!isOwner) {
    return (
      <div className="centered-container">
        <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
          Secret key is not the owner?
        </h1>
      </div>
    )
  }

  return (
    <>
      <div className="centered-container space-y-4">
        <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
          Card #{shortenAddress(safeAddress)}
        </h1>
        <p>Redeem this card to secure your funds.</p>

        {isConnected ? (
          <>
            <p>
              Account {shortenAddress(userAddress!)} will be the new owner.
              <br />
              Not correct?{" "}
              <button
                onClick={() => disconnect()}
                className="underline decoration-dotted underline-offset-2"
              >
                Log out here
              </button>
            </p>
            {taskStatus ? (
              <p className="text-green-500">
                Task Status: {taskStatus.taskState}
              </p>
            ) : (
              <Button disabled={isLoading} onClick={() => claim()}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Redeem
              </Button>
            )}
          </>
        ) : null}
      </div>
      <Footer />
    </>
  )
}

export function Footer() {
  const { isConnected, address } = useAccount()
  const { disconnect } = useDisconnect()

  return (
    <footer className="space-y-2 px-4 py-2 text-center">
      {isConnected ? (
        <p>
          Logged in with account {shortenAddress(address!)}. Not correct?{" "}
          <button
            onClick={() => disconnect()}
            className="underline decoration-dotted underline-offset-2"
          >
            Log out here
          </button>
        </p>
      ) : (
        <>
          <p>Login</p>

          <LoginButton />
        </>
      )}
    </footer>
  )
}
